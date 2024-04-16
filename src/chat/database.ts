import { Context } from 'koishi';

declare module 'koishi' {
  interface Tables {
    chat: ChatTemplate;
  }
}

export interface ChatTemplate {
  id: number;
  channelKey: string;
  // If matching mode is cn.
  inexact: boolean;
  question: string;
  answer: string;
  timestamp: number;
  author: string;
}

export const declareSchema = (ctx: Context) => {
  ctx.database.extend(
    'chat',
    {
      id: { type: 'unsigned', nullable: false },
      channelKey: { type: 'string', nullable: false },
      inexact: { type: 'boolean', nullable: false },
      question: { type: 'string', nullable: false },
      answer: { type: 'text', nullable: false },
      timestamp: { type: 'unsigned', nullable: false },
      author: { type: 'string', nullable: false },
    },
    {
      primary: 'id',
      autoInc: true,
    },
  );
};
