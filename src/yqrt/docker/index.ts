import Docker from 'dockerode';
import { Context, Schema } from 'koishi';

import { getChannelKey } from '../../common';
import Queue from './Queue';
import buildImage from './build';
import { initializeStates } from './controller';

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

export async function apply(ctx: Context, config: Config) {
  const docker = new Docker();
  // Build the runtime image
  await buildImage(docker);

  const sessionsStates = await initializeStates(
    ctx,
    docker,
    { timeout: config.timeoutCompile },
    { timeout: config.timeoutRun },
  );
  const queue = new Queue(config.concurrency);
  queue.start();

  ctx.on('dispose', async () => {
    // Drain the queue
    await queue.stop();
  });

  ctx
    .command('yqrt.list', 'List all yqrt programs in the channel.')
    .action(({ session }) => {
      const state = sessionsStates.getState(session);
      const list = state.list();
      if (list.length === 0) {
        return 'No programs yet.';
      }
      return list.join('\n');
    });

  ctx
    .command('yqrt.add <code:text>', 'Add a yqrt program to the channel.', {
      checkUnknown: true,
      checkArgCount: true,
    })
    .action(async ({ session }, code) => {
      const channelKey = getChannelKey(session);
      const state = sessionsStates.getState(channelKey);
      try {
        const { id, initialResponse } = await queue.process(
          state.create(code, {
            channelKey,
            author: session.userId,
            timestamp: session.timestamp,
          }),
        );
        return `Program added: ${id}\n${initialResponse}`;
      } catch (error) {
        return `Failed to create container: ${error.message}`;
      }
    });

  ctx
    .command('yqrt.invoke <id:string> <input:text>', 'Invoke a yqrt program.', {
      checkUnknown: true,
      checkArgCount: true,
    })
    .action(async ({ session }, id, input) => {
      const state = sessionsStates.getState(session);
      try {
        const { response, error } = await queue.process(
          state.run(id, {
            type: 'message',
            data: input,
          }),
        );
        ctx.logger.info(
          `invoked ${id}, response: ${JSON.stringify(response)}, error: ${JSON.stringify(error)}`,
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
      { checkUnknown: true, checkArgCount: true },
    )
    .option('force', '-f')
    .action(async ({ session, options }, id) => {
      const state = sessionsStates.getState(session);
      try {
        await queue.process(state.remove(id, options.force ?? false));
      } catch (error) {
        return `Failed to remove container: ${error.message}`;
      }
      return `Program removed: ${id}`;
    });
}
