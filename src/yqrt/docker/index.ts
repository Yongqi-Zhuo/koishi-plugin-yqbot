import Docker from 'dockerode';
import { Context, Schema } from 'koishi';

import buildImage from './build';
import Container from './container';
import { Manager } from './manager';
import { CreationResult } from './model';

export const name = 'yqrt-docker';

export const inject = ['database'];

export interface Config {
  concurrency: number;
  timeoutCompile: number;
  timeoutRun: number;
}

export const Config: Schema<Config> = Schema.object({
  concurrency: Schema.natural()
    .default(1)
    .min(1)
    .description('Number of concurrent tasks.'),
  timeoutCompile: Schema.number()
    .default(10000)
    .min(100)
    .description('Timeout for compilation in milliseconds.'),
  timeoutRun: Schema.number()
    .default(2000)
    .min(100)
    .description('Timeout for running code in milliseconds.'),
});

declare module 'koishi' {
  interface Channel {
    yqprograms: string[];
  }
}

export async function apply(ctx: Context, config: Config) {
  ctx.model.extend('channel', {
    yqprograms: 'list',
  });

  const docker = new Docker();
  // Build the runtime image
  await buildImage(docker);

  const manager = new Manager(
    ctx,
    docker,
    config.concurrency,
    {
      timeout: config.timeoutCompile,
    },
    {
      timeout: config.timeoutRun,
    },
  );

  manager.start();

  ctx.on('dispose', async () => {
    await manager.close();
  });

  ctx
    .command('yqrt.list', 'List all yqrt programs in the channel.')
    .channelFields(['yqprograms'])
    .action(({ session }) => {
      if (!session.channel?.yqprograms?.length) {
        return 'No programs yet.';
      }
      return session.channel.yqprograms.join('\n');
    });

  ctx
    .command('yqrt.add <code:text>', 'Add a yqrt program to the channel.')
    .channelFields(['yqprograms'])
    .action(async ({ session }, code) => {
      try {
        const { id, initialResponse } = await manager.create(code);
        session.channel.yqprograms.push(id);
        return `Program added: ${id}\n${initialResponse}`;
      } catch (error) {
        return `Failed to create container: ${error.message}`;
      }
    });

  ctx
    .command('yqrt.invoke <id:string> <input:text>', 'Invoke a yqrt program.')
    .channelFields(['yqprograms'])
    .action(async ({ session }, id, input) => {
      if (!session.channel.yqprograms.includes(id)) {
        return 'Program not found.';
      }
      try {
        return await manager.run(id, {
          type: 'message',
          data: input,
        });
      } catch (error) {
        return `Failed to run container: ${error.message}`;
      }
    });

  ctx
    .command(
      'yqrt.remove <id:string>',
      'Remove a yqrt program from the channel.',
    )
    .option('force', '-f')
    .channelFields(['yqprograms'])
    .action(async ({ session, options }, id) => {
      const index = session.channel.yqprograms.indexOf(id);
      if (index === -1) {
        return 'Program not found.';
      }
      try {
        await manager.remove(id, options.force ?? false);
      } catch (error) {
        return `Failed to remove container: ${error.message}`;
      }
      session.channel.yqprograms.splice(index, 1);
      return `Program removed: ${id}`;
    });
}
