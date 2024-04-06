import { Context, Session } from 'koishi';

import HashIndex, {
  HashIndexExempts,
  Hash as HashIndexHash,
  HashIndexHashes,
} from './HashIndex';

declare module 'koishi' {
  interface Tables {
    sglOrigin: SglOrigin;
    sglRecord: SglRecord;
  }
}

export interface SglOrigin {
  id: number;
  channelKey: string;
  // No BigInt, so we use string.
  // Because we build up efficient data structure for queries anyway.
  hash: string;
  senderId: string;
  timestamp: number;
  exempt: boolean;
}

export interface SglRecord {
  id: number;
  channelKey: string;
  originId: number;
  userId: string;
  timestamp: number;
}

export const declareSchema = (ctx: Context) => {
  ctx.database.extend(
    'sglOrigin',
    {
      id: { type: 'unsigned', nullable: false },
      channelKey: { type: 'string', nullable: false },
      hash: { type: 'char', nullable: false },
      senderId: { type: 'string', nullable: false },
      timestamp: { type: 'unsigned', nullable: false },
      exempt: { type: 'boolean', nullable: false },
    },
    {
      primary: 'id',
      autoInc: true,
    },
  );
  ctx.database.extend(
    'sglRecord',
    {
      id: { type: 'unsigned', nullable: false },
      channelKey: { type: 'string', nullable: false },
      originId: { type: 'unsigned', nullable: false },
      userId: { type: 'string', nullable: false },
      timestamp: { type: 'unsigned', nullable: false },
    },
    {
      primary: 'id',
      autoInc: true,
      foreign: {
        originId: ['sglOrigin', 'id'],
      },
    },
  );
};

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
): Promise<Map<string, HashIndex>> => {
  const states: Map<string, HashIndex> = new Map();
  const origins = await ctx.database.select('sglOrigin').execute();
  const groups = groupOrigins(origins);
  for (const [channelKey, { hashes, exempts }] of groups) {
    states.set(channelKey, new HashIndex(tolerance, hashes, exempts));
  }
  return states;
};

// Handle database operations.
export class DatabaseHandle {
  readonly channelKey: string;
  private readonly ctx: Context;
  private readonly session: Session;
  readonly index: HashIndex;

  constructor(
    channelKey: string,
    ctx: Context,
    session: Session,
    index: HashIndex,
  ) {
    this.channelKey = channelKey;
    this.ctx = ctx;
    this.session = session;
    this.index = index;
  }

  async insertOrigin(hash: HashIndexHash): Promise<undefined> {
    const { userId, timestamp } = this.session;
    const { id } = await this.ctx.database.create('sglOrigin', {
      channelKey: this.channelKey,
      hash: hash.toString(),
      senderId: userId,
      timestamp,
      exempt: false,
    });
    this.index.insert({ key: id, hash });
    return;
  }

  // Add a record to the database, and look up the origin.
  async addRecordAndQueryOrigin(originId: number): Promise<SglOrigin> {
    const { userId, timestamp } = this.session;
    const recordPromise = this.ctx.database.create('sglRecord', {
      channelKey: this.channelKey,
      originId,
      userId,
      timestamp,
    });
    const originPromise = this.ctx.database.get('sglOrigin', originId);
    // Interleave the two promises.
    const [_, origin] = await Promise.all([recordPromise, originPromise]);
    return origin[0];
  }

  async setExempt(originId: number) {
    this.index.setExempt(originId);
    await this.ctx.database.set('sglOrigin', originId, {
      exempt: true,
    });
  }
}
