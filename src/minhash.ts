// MinHash + band-LSH — datasketch-compatible drop-in (no scipy/numpy).
//
// Covers the exact MinHash/MinHashLSH API surface used by dedup.py.
// Hash family (Mersenne-prime permutations) and LSH band structure are
// equivalent to datasketch so dedup quality is unchanged.

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _MP = (1n << 61n) - 1n; // Mersenne prime for the hash family
const _MH = 0xffffffffn; // mask to 32-bit values

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32 with seed=1
// ---------------------------------------------------------------------------

// NOTE: Python uses np.random.RandomState(1) (Mersenne Twister). This JS
// implementation uses a different PRNG, so the generated coefficients differ
// from the Python version. The MinHash algorithm is still correct — only
// the specific hash-family permutation changes.
function _mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One (a, b) coefficient array per num_perm, shared across all instances.
const _MH_COEFFS: Map<number, { a: bigint[]; b: bigint[] }> = new Map();

function _mhCoeffs(numPerm: number): { a: bigint[]; b: bigint[] } {
  const cached = _MH_COEFFS.get(numPerm);
  if (cached) return cached;

  const rng = _mulberry32(1);
  const a: bigint[] = [];
  const b: bigint[] = [];
  const mpNumber = Number(_MP);

  for (let i = 0; i < numPerm; i++) {
    // a in [1, MP), b in [0, MP)
    a.push(BigInt(Math.floor(rng() * (mpNumber - 1)) + 1));
    b.push(BigInt(Math.floor(rng() * mpNumber)));
  }

  const result = { a, b };
  _MH_COEFFS.set(numPerm, result);
  return result;
}

// ---------------------------------------------------------------------------
// MinHash
// ---------------------------------------------------------------------------

export class MinHash {
  numPerm: number;
  hashvalues: number[];
  private _a: bigint[];
  private _b: bigint[];

  constructor(numPerm: number = 128) {
    this.numPerm = numPerm;
    this.hashvalues = new Array(numPerm).fill(Number(_MH));
    const coeffs = _mhCoeffs(numPerm);
    this._a = coeffs.a;
    this._b = coeffs.b;
  }

  update(v: Uint8Array): void {
    const digest = createHash("sha1").update(v).digest();
    // Take first 4 bytes as a little-endian uint32
    const hv =
      digest[0]! | (digest[1]! << 8) | (digest[2]! << 16) | (digest[3]! << 24);
    const hvBig = BigInt(hv >>> 0); // unsigned

    for (let i = 0; i < this.numPerm; i++) {
      const phv = Number(((this._a[i]! * hvBig + this._b[i]!) % _MP) & _MH);
      if (phv < this.hashvalues[i]!) {
        this.hashvalues[i] = phv;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// LSH parameter optimisation
// ---------------------------------------------------------------------------

function _lshIntegrate(
  f: (s: number) => number,
  lo: number,
  hi: number,
  n: number = 128
): number {
  const h = (hi - lo) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += f(lo + i * h);
  }
  return h * sum;
}

const _LSH_PARAMS_CACHE: Map<string, [number, number]> = new Map();

/** Find (bands, rows) that minimise weighted FP+FN error, without scipy. */
export function _optimalLshParams(
  threshold: number,
  numPerm: number
): [number, number] {
  const key = `${threshold}:${numPerm}`;
  const cached = _LSH_PARAMS_CACHE.get(key);
  if (cached) return cached;

  let bestErr = Infinity;
  let best: [number, number] = [1, 1];

  for (let b = 1; b <= numPerm; b++) {
    for (let r = 1; r <= Math.floor(numPerm / b); r++) {
      const bF = b;
      const rF = r;
      const fp = _lshIntegrate(
        (s) => 1 - Math.pow(1 - Math.pow(s, rF), bF),
        0,
        threshold
      );
      const fn = _lshIntegrate(
        (s) => 1 - (1 - Math.pow(1 - Math.pow(s, rF), bF)),
        threshold,
        1
      );
      const err = 0.5 * fp + 0.5 * fn;
      if (err < bestErr) {
        bestErr = err;
        best = [b, r];
      }
    }
  }

  _LSH_PARAMS_CACHE.set(key, best);
  return best;
}

// ---------------------------------------------------------------------------
// MinHashLSH
// ---------------------------------------------------------------------------

export class MinHashLSH {
  b: number;
  r: number;
  private _tables: Map<string, string[]>[];
  private _keys: Set<string>;

  constructor(threshold: number = 0.5, numPerm: number = 128) {
    const [b, r] = _optimalLshParams(threshold, numPerm);
    this.b = b;
    this.r = r;
    this._tables = [];
    for (let i = 0; i < b; i++) {
      this._tables.push(new Map());
    }
    this._keys = new Set();
  }

  insert(key: string, minhash: MinHash): void {
    if (this._keys.has(key)) {
      throw new Error(`Key '${key}' already exists in MinHashLSH`);
    }
    this._keys.add(key);
    const hv = minhash.hashvalues;
    for (let i = 0; i < this.b; i++) {
      // Build a hash key from the band's hashvalues
      const bandStart = i * this.r;
      const bandEnd = bandStart + this.r;
      const bandKey = hv.slice(bandStart, bandEnd).join(",");
      const table = this._tables[i]!;
      const existing = table.get(bandKey);
      if (existing) {
        existing.push(key);
      } else {
        table.set(bandKey, [key]);
      }
    }
  }

  query(minhash: MinHash): string[] {
    const hv = minhash.hashvalues;
    const candidates = new Set<string>();
    for (let i = 0; i < this.b; i++) {
      const bandStart = i * this.r;
      const bandEnd = bandStart + this.r;
      const bandKey = hv.slice(bandStart, bandEnd).join(",");
      const matches = this._tables[i]!.get(bandKey);
      if (matches) {
        for (const m of matches) {
          candidates.add(m);
        }
      }
    }
    return [...candidates];
  }
}
