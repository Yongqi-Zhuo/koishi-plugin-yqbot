import HashIndex, {
  QueryResultExempt,
  QueryResultFound,
} from '../src/sgl/HashIndex';
import { expect } from 'chai';

describe('HashIndex', function () {
  const half = Number(1n << 32n);
  const generateRandom32Bit = (): bigint =>
    BigInt(Math.floor(Math.random() * half));
  // Randomly generate some 64-bit hashes
  const generateRandomHash = (): bigint => {
    return (generateRandom32Bit() << 32n) + generateRandom32Bit();
  };
  const totalHashes = 100;
  const exemptedHashes = 10;
  const hashes: bigint[] = [];
  for (let i = 0; i < totalHashes; i++) {
    hashes.push(generateRandomHash());
  }

  const tolerance = 7;

  const hashIndex = new HashIndex(
    tolerance,
    new Map(hashes.map((hash, i) => [i, hash])),
    new Set(Array(exemptedHashes).keys()),
  );

  // Randomly select `tolerance` bits to flip
  const mutate = (hash: bigint) => {
    for (let i = 0; i < tolerance; i++) {
      const bit = BigInt(1) << BigInt(Math.floor(Math.random() * 64));
      hash ^= bit;
    }
    return hash;
  };

  it('should query hashes correctly', function () {
    for (const [i, hash] of hashes.entries()) {
      const mutated = mutate(hash);
      let result = hashIndex.query(mutated);
      if (i < exemptedHashes) {
        expect(result.kind).to.equal('exempt');
        result = result as QueryResultExempt;
        expect(result.key).to.equal(i);
        expect(result.hash).to.equal(hash);
      } else {
        expect(result.kind).to.equal('found');
        result = result as QueryResultFound;
        expect(result.key).to.equal(i);
        expect(result.hash).to.equal(hash);
      }
    }
  });

  it('should reject non-existent hashes', function () {
    for (let i = 0; i < totalHashes; i++) {
      const nonExistentHash = generateRandomHash();
      const result = hashIndex.query(mutate(nonExistentHash));
      // 100 * 100 / 2 ** (64 - 7) chance of false positive.
      expect(result.kind).to.equal('none');
    }
  });

  it('should insert correctly', function () {
    const hash = generateRandomHash();
    const key = totalHashes;
    hashIndex.insert({ key, hash });
    let result = hashIndex.query(hash);
    expect(result.kind).to.equal('found');
    result = result as QueryResultFound;
    expect(result.key).to.equal(key);
    expect(result.hash).to.equal(hash);
  });
});
