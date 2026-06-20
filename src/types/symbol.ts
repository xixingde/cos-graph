export interface SymbolDeclarationFact {
  filePath: string;
  name: string;
  line: number;
}

export interface SymbolImportFact {
  filePath: string;
  localName: string;
  targetPath: string;
  importedName: string;
  line: number;
}

export interface SymbolAliasFact {
  filePath: string;
  alias: string;
  targetName: string;
  line: number;
}

export interface SymbolExportFact {
  filePath: string;
  exportedName: string;
  line: number;
  localName?: string;
  targetPath?: string;
  targetName?: string;
}

export interface StarExportFact {
  filePath: string;
  targetPath: string;
  line: number;
}

export interface SymbolUseFact {
  filePath: string;
  sourceId: string;
  localName: string;
  relation: string;
  context: string;
  line: number;
}

export interface ModuleImport {
  importingFile: string;
  submoduleFile: string;
  line: number;
}

export interface SymbolResolutionFacts {
  declarations: SymbolDeclarationFact[];
  imports: SymbolImportFact[];
  aliases: SymbolAliasFact[];
  exports: SymbolExportFact[];
  starExports: StarExportFact[];
  uses: SymbolUseFact[];
  moduleImports: ModuleImport[];
}

export interface ImportedSymbol {
  localName: string;
  importedName: string;
  moduleStem: string;
  sourceFile: string;
  sourceLocation: string;
}
