import Docker from 'dockerode';
import { Context, Schema, h } from 'koishi';

import { formatTimestamp, getChannelKey, getNickname } from '../../common';
import { Queue } from '../../utils';
import { Languages } from '../common';
import { initializeStates } from './controller';
import buildImage from './build';

declare module 'dockerode' {
  interface DockerVersion {
    Experimental?: boolean;
  }
}

export const name = 'yqrt-docker';

export interface Config {
  endpoint: 'socket' | 'http';
  socketPath?: string;
  httpHost?: string;
  httpPort?: number;
  concurrency: number;
  maxConsecutiveErrors: number;
  timeoutCompile: number;
  timeoutRun: number;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    concurrency: Schema.natural()
      .default(1)
      .min(1)
      .description('Number of concurrent tasks.'),
    maxConsecutiveErrors: Schema.natural()
      .default(3)
      .description(
        'Maximum number of consecutive errors, before we no longer invoke the program on events.',
      ),
    timeoutCompile: Schema.number()
      .default(10000)
      .min(100)
      .description('Timeout for compilation in milliseconds.'),
    timeoutRun: Schema.number()
      .default(2000)
      .min(100)
      .description('Timeout for running code in milliseconds.'),
    endpoint: Schema.union(['socket', 'http'])
      .default('socket')
      .description('Docker endpoint type.'),
  }),
  Schema.union([
    Schema.object({
      endpoint: Schema.const('socket'),
      socketPath: Schema.string().default('/var/run/docker.sock'),
    }),
    Schema.object({
      endpoint: Schema.const('http'),
      httpHost: Schema.string().default('localhost'),
      httpPort: Schema.natural().default(2375),
    }),
  ]),
]);

export async function apply(ctx: Context, config: Config) {
  let dockerOptions: Docker.DockerOptions;
  switch (config.endpoint) {
    case 'socket':
      dockerOptions = { socketPath: config.socketPath };
      break;
    case 'http':
      dockerOptions = { host: config.httpHost, port: config.httpPort };
      break;
  }
  ctx.logger.info('Connecting to Docker daemon:', dockerOptions);
  const docker = new Docker(dockerOptions);
  {
    const info = await docker.version();
    if (!info.Experimental) {
      ctx.logger.error(
        'Docker daemon is not in experimental mode. Cannot proceed.',
      );
      return;
    }
    ctx.logger.info('Connected to Docker daemon:', info);
  }

  // Build the runtime image
  await buildImage(docker);
  ctx.logger.info('Built Docker image.');

  const queue = new Queue(config.concurrency);
  const sessionsStates = await initializeStates(
    ctx,
    docker,
    queue,
    { timeout: config.timeoutCompile },
    { timeout: config.timeoutRun },
    config.maxConsecutiveErrors,
  );
  queue.start();

  ctx.on('dispose', async () => {
    // Drain the queue
    await queue.stop();
  });

  ctx.middleware(async (session, next) => {
    const controller = sessionsStates.getController(session);
    // This will not throw.
    const tasks = await controller.event({
      type: 'message',
      data: session.content,
    });
    await Promise.all(
      tasks.map(async (task) => {
        if (task.kind === 'success') {
          const { response } = task;
          if (response) {
            // Do not escape, because we want rich text result.
            await session.sendQueued(response);
          }
        } else {
          await session.sendQueued(
            h.text(`Failed to run container ${task.id}: ${task.exception}`),
          );
        }
      }),
    );
    return next();
  });

  ctx
    .command('yqrt.find <abbr:string>', 'Find a yqrt program in the channel.', {
      checkUnknown: true,
      checkArgCount: true,
    })
    .action(({ session }, abbr) => {
      const controller = sessionsStates.getController(session);
      try {
        const id = controller.find(abbr);
        return h.text(id);
      } catch (error) {
        return h.text(`Failed to find container: ${error}`);
      }
    });

  ctx
    .command('yqrt.add <code:text>', 'Add a yqrt program to the channel.', {
      checkUnknown: true,
      checkArgCount: true,
    })
    .option('language', '-l <value:string>', { fallback: 'c++' })
    .option('title', '-t <value:string>', { fallback: '' })
    .action(async ({ session, options }, code) => {
      const { language, title } = options;
      if (!Languages.includes(language as any)) {
        return h.text(
          `Invalid language. Possible languages: ${Languages.join(', ')}.`,
        );
      }

      const channelKey = getChannelKey(session);
      const controller = sessionsStates.getController(channelKey);
      try {
        const { id, initialResponse } = await controller.create(code, {
          channelKey,
          language,
          title,
          source: code,
          author: session.userId,
          timestamp: session.timestamp,
        });
        return h.text(`Program added: ${id}\n${initialResponse}`);
      } catch (error) {
        return h.text(`Failed to create container: ${error}`);
      }
    });

  ctx
    .command(
      'yqrt.invoke <abbr:string> <input:text>',
      'Invoke a yqrt program.',
      {
        checkUnknown: true,
        checkArgCount: true,
      },
    )
    .action(async ({ session }, abbr, input) => {
      const controller = sessionsStates.getController(session);
      try {
        const { id, response, error } = await controller.invoke(abbr, {
          type: 'message',
          data: input,
        });
        ctx.logger.info(
          `invoked ${id}, response: ${JSON.stringify(response)}, error: ${JSON.stringify(error)}`,
        );
        // Do not escape, because we want rich text result.
        return response;
      } catch (error) {
        return h.text(`Failed to run container: ${error}`);
      }
    });

  ctx
    .command(
      'yqrt.remove <abbr:string>',
      'Remove a yqrt program from the channel.',
      { checkUnknown: true, checkArgCount: true },
    )
    .option('force', '-f')
    .action(async ({ session, options }, abbr) => {
      const controller = sessionsStates.getController(session);
      try {
        const { id } = await controller.remove(abbr, options.force ?? false);
        return h.text(`Program removed: ${id}`);
      } catch (error) {
        return `Failed to remove container: ${error}`;
      }
    });

  ctx
    .command(
      'yqrt.inspect <abbr:string>',
      'Inspect a yqrt program in the channel.',
      { checkUnknown: true, checkArgCount: true },
    )
    .action(async ({ session }, abbr) => {
      const controller = sessionsStates.getController(session);
      try {
        const metadata = controller.inspect(abbr);
        const { id, version, language, title, source, author, timestamp } =
          metadata;
        const nickname = await getNickname(session, author);
        const time = formatTimestamp(timestamp);
        return h.text(
          `yqrt program: ${id}\nruntime version: ${version}\nlanguage: ${language}\ntitle: ${title}\nauthor: ${nickname}\ntime: ${time}\n\n${source}`,
        );
      } catch (error) {
        return h.text(`Failed to inspect container: ${error}`);
      }
    });

  ctx
    .command('yqrt.list', 'List all yqrt programs in the channel.')
    .action(async ({ session }) => {
      const controller = sessionsStates.getController(session);
      const list = controller.list();
      if (list.length === 0) {
        return 'No programs yet.';
      }
      const desc = await Promise.all(
        list.map(
          async ({
            id,
            language,
            title,
            author,
            timestamp,
            consecutiveErrors,
          }) => {
            if (title === '') title = '<untitled>';
            const nickname = await getNickname(session, author);
            const time = formatTimestamp(timestamp);
            const errors =
              consecutiveErrors > 0 ? `, now ${consecutiveErrors} errors` : '';
            return `${id} (${title}): ${language}, by ${nickname}, at ${time}${errors}`;
          },
        ),
      );
      return h.text(desc.join('\n'));
    });
}
