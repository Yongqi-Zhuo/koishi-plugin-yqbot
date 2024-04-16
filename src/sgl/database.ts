import { $, Context, Session } from 'koishi';

import HashIndex, { Hash as HashIndexHash } from './HashIndex';

declare module 'koishi' {
  interface Tables {
    sglOrigin: SglOrigin;
    sglRecord: SglRecord;
  }
  interface Channel {
    sglEnabled: boolean;
    sglTolerance: number;
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

export type Ranking = {
  userId: string;
  count: number;
};

export const declareSchema = (ctx: Context, defaultTolerance: number) => {
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
  ctx.database.extend('channel', {
    sglEnabled: { type: 'boolean', nullable: false, initial: false },
    sglTolerance: {
      type: 'unsigned',
      nullable: false,
      initial: defaultTolerance,
    },
  });
};

// Handle database operations.
export class DatabaseHandle {
  constructor(
    private readonly channelKey: string,
    private readonly ctx: Context,
    readonly index: HashIndex,
  ) {}

  async insertOrigin(
    hash: HashIndexHash,
    { userId, timestamp }: Session,
  ): Promise<undefined> {
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
  async addRecordAndQueryOrigin(
    originId: number,
    { userId, timestamp }: Session,
  ): Promise<SglOrigin> {
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

  async rankings(fromDate: number): Promise<Ranking[]> {
    return await this.ctx.database
      .select('sglRecord')
      .where((row) =>
        $.and(
          $.eq(row.channelKey, this.channelKey),
          $.gte(row.timestamp, fromDate),
        ),
      )
      .groupBy('userId', {
        count: (row) => $.count(row.id),
      })
      .orderBy('count', 'desc')
      .execute();
  }
}
