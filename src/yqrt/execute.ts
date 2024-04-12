// See https://github.com/compiler-explorer/compiler-explorer/blob/main/lib/exec.ts.
//
// Copyright (c) 2017, Compiler Explorer Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//   * Redistributions of source code must retain the above copyright notice,
//     this list of conditions and the following disclaimer.
//   * Redistributions in binary form must reproduce the above copyright
//     notice, this list of conditions and the following disclaimer in the
//     documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import buffer from 'buffer';
import child_process from 'child_process';
import { Logger } from 'koishi';
import path from 'path';
import { Stream } from 'stream';
import treeKill from 'tree-kill';
import _ from 'underscore';

const logger = new Logger('yqrt-executor');

export type ExecutionOptions = {
  timeoutMs?: number;
  env?: Record<string, string>;
  wrapper?: string;
  maxOutput?: number;
  ldPath?: string[];
  customCwd?: string;
  // Stdin
  input?: string | Buffer | Uint8Array;
  killChild?: () => void;
};

export type UnprocessedExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  execTime: string;
  timedOut: boolean;
  truncated: boolean;
};

const firejailCommand = 'firejail';

function getFirejailProfileFilePath(
  profileName: 'sandbox' | 'execute',
): string {
  return path.join(__dirname, 'firejail', `${profileName}.profile`);
}

function executeDirect(
  command: string,
  args: string[],
  options: ExecutionOptions,
): Promise<UnprocessedExecResult> {
  options = options || {};
  const maxOutput = Math.min(
    options.maxOutput || 1024 * 1024,
    buffer.constants.MAX_STRING_LENGTH,
  );
  const timeoutMs = options.timeoutMs || 0;
  const env = { ...process.env, ...options.env };

  if (options.ldPath) {
    env.LD_LIBRARY_PATH = options.ldPath.join(path.delimiter);
  }

  if (options.wrapper) {
    args = args.slice(0); // prevent mutating the caller's arguments
    args.unshift(command);
    command = options.wrapper;

    if (command.startsWith('./')) command = path.join(process.cwd(), command);
  }

  let timedOut = false;
  const cwd = options.customCwd;
  logger.debug('Execution', {
    type: 'executing',
    command: command,
    args: args,
    env: env,
    cwd: cwd,
  });
  const startTime = process.hrtime.bigint();

  const child = child_process.spawn(command, args, {
    env: env,
    detached: process.platform === 'linux',
  });
  let running = true;

  const kill =
    options.killChild ||
    (() => {
      if (running && child && child.pid) {
        // Close the stdin pipe on our end, otherwise we'll get an EPIPE
        child.stdin.destroy();
        treeKill(child.pid);
      }
    });

  const streams = {
    stderr: '',
    stdout: '',
    truncated: false,
  };
  let timeout: NodeJS.Timeout | undefined;
  if (timeoutMs)
    timeout = setTimeout(() => {
      logger.warn(`Timeout for ${command} ${args} after ${timeoutMs}ms`);
      timedOut = true;
      kill();
      streams.stderr += '\nKilled - processing time exceeded\n';
    }, timeoutMs);

  function setupStream(stream: Stream, name: 'stdout' | 'stderr') {
    if (stream === undefined) return;
    stream.on('data', (data) => {
      if (streams.truncated) return;
      const newLength = streams[name].length + data.length;
      if (maxOutput > 0 && newLength > maxOutput) {
        const truncatedMsg = '\n[Truncated]';
        const spaceLeft = Math.max(
          maxOutput - streams[name].length - truncatedMsg.length,
          0,
        );
        streams[name] = streams[name] + data.slice(0, spaceLeft);
        streams[name] += truncatedMsg.slice(
          0,
          maxOutput - streams[name].length,
        );
        streams.truncated = true;
        kill();
        return;
      }
      streams[name] += data;
    });
    setupOnError(stream, name);
  }

  setupOnError(child.stdin, 'stdin');
  setupStream(child.stdout, 'stdout');
  setupStream(child.stderr, 'stderr');
  child.on('exit', (code) => {
    logger.debug('Execution', { type: 'exited', code: code });
    if (timeout !== undefined) clearTimeout(timeout);
    running = false;
  });
  return new Promise((resolve, reject) => {
    child.on('error', (e) => {
      logger.debug(`Execution error with ${command} args: ${args}:`, e);
      reject(e);
    });
    child.on('close', (code) => {
      // Being killed externally gives a NULL error code. Synthesize something different here.
      if (code === null) code = -1;
      if (timeout !== undefined) clearTimeout(timeout);
      const endTime = process.hrtime.bigint();
      const result: UnprocessedExecResult = {
        code,
        timedOut,
        stdout: streams.stdout,
        stderr: streams.stderr,
        truncated: streams.truncated,
        execTime: ((endTime - startTime) / BigInt(1000000)).toString(),
      };
      // Check debug level explicitly as result may be a very large string
      // which we'd prefer to avoid preparing if it won't be used
      if (logger.level >= Logger.DEBUG) {
        logger.debug('Execution', {
          type: 'executed',
          command: command,
          args: args,
          result: result,
        });
      }
      resolve(result);
    });
    if (child.stdin) {
      if (options.input) child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

function checkExecOptions(options: ExecutionOptions) {
  if (options.env) {
    for (const key of Object.keys(options.env)) {
      const value: any = options.env[key];
      if (value !== undefined && typeof value !== 'string') {
        logger.warn(
          `Found non-string in environment: ${key} of ${typeof value} : '${value}'`,
        );
        options.env[key] = value.toString();
      }
    }
  }
}

function setupOnError(stream: Stream, name: string) {
  if (stream === undefined) return;
  stream.on('error', (err) => {
    logger.error(`Error with ${name} stream:`, err);
  });
}

function withFirejailTimeout(args: string[], options?: ExecutionOptions) {
  if (options && options.timeoutMs) {
    // const ExtraWallClockLeewayMs = 1000;
    const ExtraCpuLeewayMs = 1500;
    return args.concat([
      `--rlimit-cpu=${Math.round((options.timeoutMs + ExtraCpuLeewayMs) / 1000)}`,
    ]);
  }
  return args;
}

function prepareFirejail(
  command: string,
  args: string[],
  options: ExecutionOptions,
  mode: 'sandbox' | 'execute',
) {
  logger.debug(`Running firejail in ${mode} mode:`, { command, args });

  options = _.clone(options) || {};
  const jailingOptions = withFirejailTimeout(
    [
      '--quiet',
      '--deterministic-exit-code',
      '--deterministic-shutdown',
      `--profile=${getFirejailProfileFilePath(mode)}`,
    ],
    options,
  );

  if (options.ldPath) {
    jailingOptions.push(
      `--env=LD_LIBRARY_PATH=${options.ldPath.join(path.delimiter)}`,
    );
    delete options.ldPath;
  }

  if (options.customCwd) {
    jailingOptions.push(`--private=${options.customCwd}`, '--private-cwd');
  } else {
    jailingOptions.push('--private');
  }

  return executeDirect(
    firejailCommand,
    jailingOptions.concat([command, ...args]),
    options,
  );
}

function runFirejail(
  command: string,
  args: string[],
  options: ExecutionOptions,
  mode: 'sandbox' | 'execute',
): Promise<UnprocessedExecResult> {
  checkExecOptions(options);
  if (!command) throw new Error('No executable provided');
  return prepareFirejail(command, args, options, mode);
}

export const sandbox = (
  command: string,
  args: string[],
  options: ExecutionOptions,
) => runFirejail(command, args, options, 'sandbox');

export const execute = (
  command: string,
  args: string[],
  options: ExecutionOptions,
) => runFirejail(command, args, options, 'execute');
