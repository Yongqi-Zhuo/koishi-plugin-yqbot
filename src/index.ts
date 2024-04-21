import { resolve } from 'path';

import {} from '@koishijs/plugin-console';
import { Context, Schema } from 'koishi';

import * as Chat from './chat';
import * as Sgl from './sgl';
import * as Yqrt from './yqrt';

export const name = 'yqbot';

export interface Config {
  sgl: Sgl.Config;
  chat: Chat.Config;
  yqrt: Yqrt.Config;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({ sgl: Sgl.Config }).description('图片查重'),
  Schema.object({ chat: Chat.Config }).description('自动回复'),
  Schema.object({ yqrt: Yqrt.Config }).description('yqrt'),
]);

export function apply(ctx: Context) {
  ctx.plugin(Sgl);
  ctx.plugin(Chat);
  ctx.plugin(Yqrt);

  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    });
  });
}
