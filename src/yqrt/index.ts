import { Context, Schema, h } from 'koishi';
import os from 'os';
import { parse } from 'shell-quote';
import temp from 'temp';
import _ from 'underscore';

import { sandbox } from './execute';
import { Compiler, Languages } from './compile';

temp.track();

export const name = 'yqrt';

export const inject = ['database'];

export interface Config {
  shell: boolean;
  maxOutput: number;
  timeoutCompile: number;
  timeoutRun: number;
}

export const Config: Schema<Config> = Schema.object({
  shell: Schema.boolean()
    .default(true)
    .description('Enable executing shell commands.'),
  maxOutput: Schema.natural()
    .default(2048)
    .min(256)
    .description('Max length of stdout/stderr to display.'),
  timeoutCompile: Schema.number()
    .default(2000)
    .min(100)
    .description('Timeout for compilation in milliseconds.'),
  timeoutRun: Schema.number()
    .default(2000)
    .min(100)
    .description('Timeout for running code in milliseconds.'),
});

const tempDirPrefix = 'yqbot-yqrt-';
const makeTempDir = () =>
  temp.mkdir({
    prefix: tempDirPrefix,
    dir: os.tmpdir(),
  });

export async function apply(ctx: Context, config: Config) {
  const compiler = new Compiler({
    maxOutput: config.maxOutput,
    timeoutCompile: config.timeoutCompile,
    timeoutRun: config.timeoutRun,
  });
  ctx.command(
    'yqrt',
    'A runtime for running and testing code. You can run shell commands and code in various languages.',
  );
  if (config.shell) {
    ctx
      .command('yqrt.shell <cmds:text>', 'Run shell code.')
      .action(async ({}, cmds?: string) => {
        if (!cmds) {
          return 'Invalid command. No command to run.';
        }
        const rawArgs = parse(cmds);
        if (_.all(rawArgs, (arg) => typeof arg === 'string')) {
          const args = rawArgs as string[];
          const cmd = args.shift();
          if (!cmd) {
            return h.text('Invalid command. Empty command.');
          }
          ctx.logger.info('Executing shell command:', cmd, args);
          const tmpDir = await makeTempDir();
          const result = await sandbox(cmd, args, {
            maxOutput: config.maxOutput,
            customCwd: tmpDir,
          });
          if (result.code === 0) {
            return h.text(`Success.\n${result.stdout}`);
          } else {
            return h.text(
              `Failure. Return code: ${result.code}.\nstdout:\n${result.stdout}\n${result.stderr}`,
            );
          }
        } else {
          return h.text(
            'Invalid command. General shell operator not supported.',
          );
        }
      });
  }
  ctx
    .command('yqrt.run <lang:string> <code:text>', 'Run code.')
    .action(async ({}, lang: string, code: string) => {
      if (!Languages.includes(lang as any)) {
        return h.text(
          `Invalid language. Possible languages: ${Languages.join(', ')}.`,
        );
      }
      code = code || '';
      const cwd = await makeTempDir();
      const res = await compiler.compile(code, cwd, {
        language: lang as (typeof Languages)[number],
      });
      if (res.kind === 'success') {
        const result = await res.executable.run();
        return h.text(
          `Return code: ${result.code}.\nstdout:\n${result.stdout}\n` +
            (result.stderr.length > 0 ? `stderr:\n${result.stderr}` : ''),
        );
      } else {
        return h.text(
          `Compile failure. Return code: ${res.code}.\n${res.error}`,
        );
      }
    });
}
