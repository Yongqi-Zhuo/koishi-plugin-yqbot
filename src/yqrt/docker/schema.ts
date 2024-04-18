import { Context } from 'koishi';

declare module 'koishi' {
  interface Tables {
    yqcontainer: ContainerItem;
  }
}

export interface ContainerItem {
  id: string;
  channelKey: string;
  author: string;
  timestamp: number;
}

export const declareSchema = (ctx: Context) => {
  ctx.model.extend(
    'yqcontainer',
    {
      id: { type: 'string', nullable: false },
      channelKey: { type: 'string', nullable: false },
      author: { type: 'string', nullable: false },
      timestamp: { type: 'unsigned', nullable: false },
    },
    {
      primary: 'id',
    },
  );
};
