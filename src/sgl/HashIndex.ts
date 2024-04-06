import assert from 'assert';
import { CHUNKS, CHUNK_LEN, CHUNK_MASK, distance } from './common';

// We want to look up perceptual hashes.
// The difficulty is that, we need to tolerate some difference in the hashes.
// At most `tolerance` bits in `HASH_SIZE` bits can be different.
// In practice, `HASH_SIZE` is 64 and `tolerance` is less than 8.
// So if we divide the hash into 8 chunks, then a query is in tolerance only if it matches exactly with one of the hashes in at lease one chunk.

export type Key = number;
export type Hash = bigint;
export type Pair = { key: Key; hash: Hash };

export type HashIndexHashes = Map<Key, Hash>;
export type HashIndexExempts = Set<Key>;

export type QueryResultNone = { kind: 'none'; hash: Hash };
export type QueryResultFound = { kind: 'found' } & Pair;
export type QueryResultExempt = { kind: 'exempt' } & Pair;
export type QueryResult =
  | QueryResultNone
  | QueryResultFound
  | QueryResultExempt;

export default class HashIndex {
  private readonly tolerance: number;
  private readonly hashes: HashIndexHashes;
  private readonly exempts: HashIndexExempts;

  // chunks[i][j] = all keys k where the i-th chunk of the hash of k is j.
  private readonly chunks: Map<Hash, Key[]>[];

  private addToChunks({ key, hash }: Pair) {
    for (let i = 0; i < CHUNKS; i++) {
      const chunk = this.chunks[i];
      const segment = (hash >> BigInt(i * CHUNK_LEN)) & CHUNK_MASK;
      if (!chunk.has(segment)) {
        chunk.set(segment, []);
      }
      chunk.get(segment)!.push(key);
    }
  }

  constructor(
    tolerance: number,
    hashes: HashIndexHashes,
    exempts: HashIndexExempts,
  ) {
    assert(0 <= tolerance && tolerance < CHUNKS);
    this.tolerance = tolerance;
    this.hashes = hashes;
    this.exempts = exempts;

    this.chunks = new Array(CHUNKS);
    for (let i = 0; i < CHUNKS; i++) {
      this.chunks[i] = new Map();
    }
    for (const [key, hash] of hashes) {
      this.addToChunks({ key, hash });
    }
  }

  insert(pair: Pair) {
    this.hashes.set(pair.key, pair.hash);
    this.addToChunks(pair);
  }

  setExempt(key: Key) {
    this.exempts.add(key);
  }

  query(hash: Hash): QueryResult {
    // We only need to check the first `tolerance + 1` chunks.
    // If after checking `tolerance + 1` chunks, we still have not found the key, then there are at least `tolerance + 1` bits difference for all hashes in the store.
    for (let i = 0; i <= this.tolerance; i++) {
      const chunk = this.chunks[i];
      const segment = (hash >> BigInt(i * CHUNK_LEN)) & CHUNK_MASK;
      if (chunk.has(segment)) {
        // We need to find the matching hash first.
        let result: Pair | undefined;
        for (const key of chunk.get(segment)!) {
          const target = this.hashes.get(key)!;
          const d = distance(hash, target);
          if (d <= this.tolerance) {
            result = { key, hash: target };
            break;
          }
        }
        if (result) {
          if (this.exempts.has(result.key)) {
            return { kind: 'exempt', ...result };
          } else {
            return { kind: 'found', ...result };
          }
        }
      }
    }
    // We failed.
    return { kind: 'none', hash };
  }
}
