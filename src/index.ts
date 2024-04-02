import { Context, Schema } from 'koishi';
import { resolve } from 'path';
import {} from '@koishijs/plugin-console';
import * as Sgl from './sgl';

export const name = 'yqbot';

export interface Config {
  sgl: Sgl.Config;
}

export const Config: Schema<Config> = Schema.object({
  sgl: Sgl.Config,
});

export function apply(ctx: Context) {
  ctx.plugin(Sgl);

  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    });
  });
}
