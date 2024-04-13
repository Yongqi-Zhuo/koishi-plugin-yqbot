import assert from 'assert';

export const SAMPLE_SIZE = 32;

export const LOW_SIZE = 8;

// Each hash is 64 bits long. We need 8 chunks of 8 bits each.
export const HASH_LEN = 64;
export const CHUNKS = 8;
export const CHUNK_LEN = 8;
export const CHUNK_MASK = 255n;
export const HASH_BOUND = 1n << 64n;

export const TOLERANCE_BOUND = CHUNKS - 1;

export function distance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  return diff.toString(2).replace(/0/g, '').length;
}

// Convert a bigint to binary string with 8 chunks of 8 bits each
// Separated by spaces
export const hashToBinaryString = (hash: BigInt) => {
  let result = hash.toString(2);
  assert(result.length <= HASH_LEN, 'Hash is too long');
  while (result.length < HASH_LEN) {
    result = '0' + result;
  }
  const chunks: string[] = [];
  for (let i = 0; i < CHUNKS; i++) {
    chunks.push(result.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN));
  }
  return chunks.join(' ');
};
