import Docker, { ContainerStartOptions } from 'dockerode';
import fs from 'fs';
import { PassThrough } from 'stream';

import { makeTempDir } from '../common';
import { CheckpointKey, EscapeSequence, ImageName } from './common';
import { ExecutionOptions, RuntimeEvent, encodeEvent } from './model';

const getConfig = (tempDir?: string) => ({
  HostConfig: {
    Binds: tempDir ? [`${tempDir}:/mnt`] : [],
    CapDrop: ['ALL'],
    NetworkMode: 'none',
    Memory: 256 * 1024 * 1024, // 256 MB
    MemorySwap: 256 * 1024 * 1024, // 256 MB
    PidsLimit: 16,
    Ulimits: [
      {
        Name: 'nofile',
        Soft: 16,
        Hard: 32,
      },
    ],
    OomScoreAdj: 1000,
  },
  Image: ImageName,
  Tty: false,
  OpenStdin: true,
});

export class ContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerError';
  }
}

export default class Container {
  private constructor(
    private readonly inner: Docker.Container,
    // This is maintained by ourselves.
    private running: boolean,
  ) {}

  static async Connect(docker: Docker, id: string): Promise<Container> {
    const inner = docker.getContainer(id);
    // Pretend that the container is not running.
    const wrapped = new Container(inner, false);
    // Now set the running status.
    wrapped.running = await wrapped.isRunning();
    return wrapped;
  }

  // Check the maintained value.
  private assertRunning(value: boolean) {
    if (this.running !== value) {
      throw new ContainerError(
        `Container is ${this.running ? '' : 'not'} running.`,
      );
    }
  }

  get id(): string {
    return this.inner.id;
  }

  private async inspect() {
    const info = await this.inner.inspect();
    return info.State;
  }

  // This is the source of truth.
  async isRunning(): Promise<boolean> {
    const state = await this.inspect();
    return state.Running;
  }

  private async checkpoint() {
    // We should be running by this time.
    this.assertRunning(true);
    // Create a checkpoint and exit.
    await (this.inner as any).createCheckpoint({
      checkpointId: CheckpointKey,
      exit: true,
    });
    // Now the container has exited.
    this.running = false;
  }

  private async removeCheckpoint() {
    await (this.inner as any).deleteCheckpoint(CheckpointKey);
  }

  private async start() {
    this.assertRunning(false);
    await this.inner.start();
    this.running = true;
  }

  private async startFromCheckpoint() {
    this.assertRunning(false);
    await this.inner.start({
      _query: { checkpoint: CheckpointKey },
      _body: {},
    } as ContainerStartOptions);
    this.running = true;
  }

  async remove(force: boolean = false) {
    if (!force) {
      this.assertRunning(false);
    }
    await this.inner.remove({ force });
    this.running = false;
  }

  private async emitEvent(
    event: RuntimeEvent,
    options: ExecutionOptions,
  ): Promise<string> {
    this.assertRunning(true);
    const streamWrite = await this.inner.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
    });
    const streamReadOut = new PassThrough();
    const streamReadErr = new PassThrough();
    this.inner.modem.demuxStream(streamWrite, streamReadOut, streamReadErr);

    streamReadOut.setEncoding('utf8');
    streamReadErr.resume();

    // Send the event
    const encoded = encodeEvent(event);
    await new Promise<void>((resolve, reject) =>
      streamWrite.write(encoded, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }),
    );

    // Read: response + EscapeSequence
    const response = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(
        () => reject(new ContainerError('Execution timed out')),
        options.timeout,
      );
      streamReadOut.on('data', (chunk: string) => {
        const end = chunk.indexOf(EscapeSequence);
        if (end !== -1) {
          clearTimeout(timer);
          if (end !== chunk.length - 1) {
            return reject(
              new ContainerError(
                'Slave should send no more than one escape sequence',
              ),
            );
          } else {
            return resolve(buffer + chunk.slice(0, end));
          }
        } else {
          buffer += chunk;
        }
      });
    });

    return response;
  }

  async run(event: RuntimeEvent, options: ExecutionOptions): Promise<string> {
    this.assertRunning(false);
    // First restore from checkpoint.
    await this.startFromCheckpoint();
    // Now that we are runnning, remove the checkpoint.
    await this.removeCheckpoint();
    // Then communicate with the container.
    const response = await this.emitEvent(event, options);
    await this.checkpoint();
    return response;
  }

  // Create a container from the source code of a yqrt program.
  static async Create(
    docker: Docker,
    source: string,
    options: ExecutionOptions,
  ): Promise<[Container, string]> {
    const tempDir = await makeTempDir();
    // Dump the source code to a file
    await fs.promises.writeFile(`${tempDir}/yqprogram.cpp`, source);
    const inner = await docker.createContainer(getConfig(tempDir));
    // Newly created container is guaranteed to not be running.
    const wrapped = new Container(inner, false);

    // This should compile the source code and run the program.
    try {
      await wrapped.start();
      // TODO: pass the response back to the caller
      const initialResponse = await wrapped.emitEvent(
        { type: 'init', data: '' },
        options,
      );

      // We should check if compilation failed.
      // The executable is expected to be in ${tempDir}/yqprogram.
      const stats = await fs.promises.stat(`${tempDir}/yqprogram`);
      if (!stats.isFile()) {
        throw new ContainerError('Compilation failed.');
      }

      // Check if the container is still running.
      if (!(await wrapped.isRunning())) {
        throw new ContainerError('Container exited prematurely.');
      }

      // Pause the container.
      await wrapped.checkpoint();
      if (await wrapped.isRunning()) {
        throw new ContainerError('Container failed to checkpoint.');
      }

      return [wrapped, initialResponse];
    } catch (error) {
      await wrapped.remove(true);
      throw error;
    }
  }
}
