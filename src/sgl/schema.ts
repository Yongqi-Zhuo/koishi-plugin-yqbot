import { Context } from 'koishi';

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
  ctx.model.extend(
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
  ctx.model.extend(
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
  ctx.model.extend('channel', {
    sglEnabled: { type: 'boolean', nullable: false, initial: false },
    sglTolerance: {
      type: 'unsigned',
      nullable: false,
      initial: defaultTolerance,
    },
  });
};
