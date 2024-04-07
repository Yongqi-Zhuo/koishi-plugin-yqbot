import { Context } from 'koishi';

import { SglOrigin } from './database';
import HashIndex, { HashIndexExempts, HashIndexHashes } from './HashIndex';

export class IgnoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IgnoreError';
  }
}

export class Ignore {
  private readonly value: Map<number, number> = new Map();
  // [index, originId][]
  reset(originIds: [number, number][]) {
    this.value.clear();
    for (const [index, originId] of originIds) {
      this.value.set(index, originId);
    }
  }
  // Find an originId with an index.
  // If index is not specified, assume there is only one originId.
  pop(index?: number): number {
    if (index) {
      const originId = this.value.get(index);
      if (originId) {
        this.value.delete(index);
        return originId;
      } else {
        throw new IgnoreError(`序号为 ${index} 的图片不存在。`);
      }
    }
    if (this.value.size === 0) {
      throw new IgnoreError('没有可以忽略的图片。');
    } else if (this.value.size > 1) {
      throw new IgnoreError('请指定要忽略的图片序号。');
    }
    const [[, originId]] = Array.from(this.value);
    this.value.clear();
    return originId;
  }
}

export type AntiRecallMeta = {
  userId: string;
  images: { src: string; title: string }[];
};

export type ChannelState = {
  index: HashIndex;
  // origin ids
  // none, single, multiple (index and originId)
  ignore: Ignore;
  // message id -> image urls
  antiRecall: Map<string, AntiRecallMeta>;
};
export const ChannelState = (tolerance: number) => ({
  index: new HashIndex(tolerance, new Map(), new Set()),
  ignore: new Ignore(),
  antiRecall: new Map(),
});

const groupOrigins = (origins: SglOrigin[]) => {
  type Origins = {
    hashes: HashIndexHashes;
    exempts: HashIndexExempts;
  };
  const groups = new Map<string, Origins>();
  for (const origin of origins) {
    const key = origin.channelKey;
    if (!groups.has(key)) {
      groups.set(key, { hashes: new Map(), exempts: new Set() });
    }
    const { hashes, exempts } = groups.get(key)!;
    hashes.set(origin.id, BigInt(origin.hash));
    if (origin.exempt) {
      exempts.add(origin.id);
    }
  }
  return groups;
};

// Read from database.
export const initializeStates = async (
  ctx: Context,
  tolerance: number,
): Promise<Map<string, ChannelState>> => {
  const states: Map<string, ChannelState> = new Map();
  const origins = await ctx.database.select('sglOrigin').execute();
  const groups = groupOrigins(origins);
  for (const [channelKey, { hashes, exempts }] of groups) {
    states.set(channelKey, {
      index: new HashIndex(tolerance, hashes, exempts),
      ignore: new Ignore(),
      antiRecall: new Map(),
    });
  }
  return states;
};
