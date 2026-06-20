// PostgreSQL schema introspection -- reconstruct DDL from information_schema
import { Client } from "pg";

/** Double-quote a PostgreSQL identifier, escaping embedded double-quotes. */
export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export interface PgIntrospectResult {
  ddl: string;
  virtualPath: string;
  host: string;
  dbname: string;
}

/** Parse a DSN string to extract host and dbname. */
function parseDsn(dsn: string): { host: string; dbname: string } {
  // Try URI-style first: postgresql://user:pass@host:port/dbname
  if (dsn.includes("://")) {
    try {
      const u = new URL(dsn);
      return {
        host: u.hostname || "localhost",
        dbname: u.pathname.slice(1) || "db",
      };
    } catch {
      // Fall through to key=value parsing
    }
  }

  // key=value style: "host=... dbname=... user=... password=..."
  let host = "localhost";
  let dbname = "db";
  for (const part of dsn.split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === "host") host = val;
    else if (key === "dbname") dbname = val;
  }
  return { host, dbname };
}

/**
  Connect to PostgreSQL, reconstruct DDL from information_schema.

  Returns the raw DDL string plus metadata instead of calling extractSql,
  since extractSql is not yet implemented in TypeScript. The caller can
  feed the DDL into the extraction pipeline separately.
*/
export async function introspectPostgres(dsn?: string | null): Promise<PgIntrospectResult> {
  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "pg is required for --postgres. Install with: pnpm add pg"
    );
  }

  const client = new pg.Client(dsn || undefined);
  try {
    await client.connect();
  } catch (exc: any) {
    const msg = String(exc?.message || exc).split("\n")[0];
    throw new Error(`could not connect to PostgreSQL: ${msg}`);
  }

  try {
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");

    // 1. Query tables
    const tablesRes = await client.query(`
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    `);
    const tables = tablesRes.rows as Array<{ table_schema: string; table_name: string; table_type: string }>;

    // 2. Query views
    const viewsRes = await client.query(`
      SELECT table_schema, table_name, view_definition
      FROM information_schema.views
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    `);
    const views = viewsRes.rows as Array<{ table_schema: string; table_name: string; view_definition: string | null }>;

    // 3. Query routines (functions/procedures), including language
    const routinesRes = await client.query(`
      SELECT routine_schema, routine_name, routine_type,
             routine_definition, external_language
      FROM information_schema.routines
      WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY routine_schema, routine_name;
    `);
    const routines = routinesRes.rows as Array<{
      routine_schema: string;
      routine_name: string;
      routine_type: string;
      routine_definition: string | null;
      external_language: string | null;
    }>;

    // 4. Query foreign keys -- grouped by constraint to handle composites
    const fksRes = await client.query(`
      SELECT
          tc.constraint_name,
          kcu1.table_schema,
          kcu1.table_name,
          ARRAY_AGG(kcu1.column_name ORDER BY kcu1.ordinal_position) AS columns,
          kcu2.table_schema AS foreign_table_schema,
          kcu2.table_name AS foreign_table_name,
          ARRAY_AGG(kcu2.column_name ORDER BY kcu2.ordinal_position) AS foreign_columns
      FROM
          information_schema.table_constraints AS tc
          JOIN information_schema.referential_constraints AS rc
            ON tc.constraint_name = rc.constraint_name
            AND tc.table_schema = rc.constraint_schema
          JOIN information_schema.key_column_usage AS kcu1
            ON tc.constraint_name = kcu1.constraint_name
            AND tc.table_schema = kcu1.table_schema
          JOIN information_schema.key_column_usage AS kcu2
            ON rc.unique_constraint_name = kcu2.constraint_name
            AND rc.unique_constraint_schema = kcu2.table_schema
            AND kcu1.position_in_unique_constraint = kcu2.ordinal_position
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
      GROUP BY tc.constraint_name, kcu1.table_schema, kcu1.table_name,
               kcu2.table_schema, kcu2.table_name
      ORDER BY kcu1.table_schema, kcu1.table_name;
    `);
    const fks = fksRes.rows as Array<{
      constraint_name: string;
      table_schema: string;
      table_name: string;
      columns: string[];
      foreign_table_schema: string;
      foreign_table_name: string;
      foreign_columns: string[];
    }>;

    const ddl: string[] = [];

    // Tables -- quote identifiers to handle reserved words, hyphens, mixed-case
    for (const { table_schema: schema, table_name: name, table_type: ttype } of tables) {
      if (ttype === "BASE TABLE") {
        ddl.push(`CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(name)} (id INT);`);
      }
    }

    // Views -- real body if available, stub if NULL (permission denied)
    for (const { table_schema: schema, table_name: name, view_definition: body } of views) {
      if (body) {
        ddl.push(`CREATE VIEW ${quoteIdent(schema)}.${quoteIdent(name)} AS ${body};`);
      } else {
        ddl.push(`CREATE VIEW ${quoteIdent(schema)}.${quoteIdent(name)} AS SELECT 1;`);
      }
    }

    // Functions & Procedures -- real body if available, stub if NULL
    // Use $gfx$ as the dollar-quote tag to avoid collision with $$ inside bodies.
    // Use external_language from the catalog; fall back to plpgsql if NULL/blank.
    for (const {
      routine_schema: schema,
      routine_name: name,
      routine_type: rtype,
      routine_definition: body,
      external_language: extLang,
    } of routines) {
      const lang = (extLang || "plpgsql").toLowerCase();
      const fnSig = `${quoteIdent(schema)}.${quoteIdent(name)}()`;
      const stubBody = "BEGIN SELECT 1; END;";
      if (rtype === "FUNCTION" || rtype === "PROCEDURE") {
        const actualBody = body || stubBody;
        // Represent PROCEDUREs as FUNCTION so tree-sitter-sql can parse them
        ddl.push(
          `CREATE FUNCTION ${fnSig} RETURNS void` +
          ` AS $gfx$ ${actualBody} $gfx$ LANGUAGE ${lang};`
        );
      }
    }

    // FK edges -- one ALTER TABLE per constraint (handles composite FKs correctly)
    for (const {
      constraint_name: constraintName,
      table_schema: tSchema,
      table_name: tName,
      columns: cols,
      foreign_table_schema: rSchema,
      foreign_table_name: rName,
      foreign_columns: rCols,
    } of fks) {
      const colList = cols.map(quoteIdent).join(", ");
      const refColList = rCols.map(quoteIdent).join(", ");
      ddl.push(
        `ALTER TABLE ${quoteIdent(tSchema)}.${quoteIdent(tName)} ` +
        `ADD CONSTRAINT ${quoteIdent(constraintName)} ` +
        `FOREIGN KEY (${colList}) REFERENCES ${quoteIdent(rSchema)}.${quoteIdent(rName)}(${refColList});`
      );
    }

    const ddlString = ddl.join("\n");
    const { host, dbname } = parseDsn(dsn || "");
    const virtualPath = `postgresql://${host}/${dbname}`;

    return { ddl: ddlString, virtualPath, host, dbname };
  } finally {
    await client.end();
  }
}
