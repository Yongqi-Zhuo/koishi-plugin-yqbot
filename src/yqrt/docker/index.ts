import Docker from 'dockerode';
import { Context, Schema } from 'koishi';

import buildImage from './build';
import { createContainer, removeContainer, runContainer } from './container';

export const name = 'yqrt-docker';

export interface Config {
  timeoutCompile: number;
  timeoutRun: number;
}

export const Config: Schema<Config> = Schema.object({
  timeoutCompile: Schema.number(),
  timeoutRun: Schema.number(),
});

declare module 'koishi' {
  interface Channel {
    yqprograms: string[];
  }
}

export async function apply(ctx: Context, config: Config) {
  const docker = new Docker();
  // Build the runtime image
  await buildImage(docker);

  ctx.model.extend('channel', {
    yqprograms: 'list',
  });

  ctx
    .command('yqrt.list', 'List all yqrt programs in the channel.')
    .channelFields(['yqprograms'])
    .action(({ session }) => {
      if (!session.channel.yqprograms.length) {
        return 'No programs yet.';
      }
      return session.channel.yqprograms.join('\n');
    });

  ctx
    .command('yqrt.add <code:text>', 'Add a yqrt program to the channel.')
    .channelFields(['yqprograms'])
    .action(async ({ session }, code) => {
      let container: string;
      try {
        container = await createContainer(docker, code, {
          timeout: config.timeoutCompile,
        });
      } catch (error) {
        return `Failed to create container: ${error.message}`;
      }
      session.channel.yqprograms.push(container);
      return `Program added: ${container}`;
    });

  ctx
    .command('yqrt.invoke <id:string> <input:text>', 'Invoke a yqrt program.')
    .channelFields(['yqprograms'])
    .action(async ({ session }, id, input) => {
      if (!session.channel.yqprograms.includes(id)) {
        return 'Program not found.';
      }
      try {
        const response = await runContainer(
          docker,
          id,
          { type: 'message', data: input },
          { timeout: config.timeoutRun },
        );
        return response;
      } catch (error) {
        return `Failed to run container: ${error.message}`;
      }
    });

  ctx
    .command(
      'yqrt.remove <id:string>',
      'Remove a yqrt program from the channel.',
    )
    .channelFields(['yqprograms'])
    .action(async ({ session }, id) => {
      const index = session.channel.yqprograms.indexOf(id);
      if (index === -1) {
        return 'Program not found.';
      }
      try {
        await removeContainer(docker, id);
      } catch (error) {
        return `Failed to remove container: ${error.message}`;
      }
      session.channel.yqprograms.splice(index, 1);
      return `Program removed: ${id}`;
    });
}
