import { Context, Schema } from 'koishi';

import * as Docker from './docker';
import * as Firejail from './firejail';

export const name = 'yqrt';

export const inject = ['database'];

export interface Config {
  firejail: Firejail.Config;
  docker: Docker.Config;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({ firejail: Firejail.Config }).description('Firejail'),
  Schema.object({ docker: Docker.Config }).description('Docker'),
]);

export async function apply(ctx: Context, config: Config) {
  ctx.plugin(Firejail, config.firejail);
  ctx.plugin(Docker, config.docker);
}
