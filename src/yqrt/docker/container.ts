import Docker, {
  ContainerCreateOptions,
  ContainerInspectOptions,
  ContainerStartOptions,
} from 'dockerode';
import { Logger } from 'koishi';
import { PassThrough } from 'stream';
import tar from 'tar-stream';

import {
  CheckpointKey,
  EscapeSequence,
  ExecutionOptions,
  ImageName,
  RuntimeEvent,
  encodeEvent,
} from './common';
import {
  ContainerMetadata,
  containerMetadataFromLabels,
  containerMetadataToLabels,
  isYqrtContainer,
} from './schema';

const logger = new Logger('yqrt-docker-container');

declare module 'dockerode' {
  interface ContainerStartOptions {
    _query?: {
      checkpoint?: string;
    };
    _body?: {};
  }
  interface ContainerInspectOptions {
    _query?: {
      size?: boolean;
    };
    _body?: {};
  }
  interface ContainerInspectInfo {
    SizeRw?: number;
    SizeRootFs?: number;
  }
}

const getConfig = (metadata: ContainerMetadata): ContainerCreateOptions => ({
  HostConfig: {
    CapDrop: ['ALL'],
    Memory: 256 * 1024 * 1024, // 256 MB
    MemorySwap: 256 * 1024 * 1024, // 256 MB
    NetworkMode: 'none',
    OomScoreAdj: 1000,
    PidsLimit: 16,
    Ulimits: [
      {
        Name: 'nofile',
        Soft: 16,
        Hard: 32,
      },
    ],
  },
  Image: ImageName,
  Labels: containerMetadataToLabels(metadata),
  OpenStdin: true,
  Tty: false,
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
    readonly metadata: ContainerMetadata,
  ) {}

  static async Connect(docker: Docker, id: string): Promise<Container> {
    const inner = docker.getContainer(id);
    const info = await inner.inspect();
    return new Container(
      inner,
      info.State.Running,
      containerMetadataFromLabels(info.Config.Labels),
    );
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

  get channelKey(): string {
    return this.metadata.channelKey;
  }

  // This is the source of truth.
  async isRunning(): Promise<boolean> {
    const info = await this.inner.inspect();
    return info.State.Running;
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
    });
    this.running = true;
  }

  async remove(force: boolean = false) {
    if (!force) {
      this.assertRunning(false);
    }
    await this.inner.remove({ force });
    this.running = false;
  }

  // stdout and stderr.
  private async emitEvent(
    event: RuntimeEvent,
    options: ExecutionOptions,
  ): Promise<[string, string]> {
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
    streamReadErr.setEncoding('utf8');

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
    const response = await new Promise<[string, string]>((resolve, reject) => {
      let buffer = '';
      let bufferErr = '';
      const timer = setTimeout(
        () =>
          reject(
            new ContainerError(
              `Execution timed out.\nstdout: ${buffer}\nstderr: ${bufferErr}`,
            ),
          ),
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
            buffer += chunk.slice(0, end);
            return resolve([buffer, bufferErr]);
          }
        } else {
          buffer += chunk;
        }
      });
      streamReadErr.on('data', (chunk: string) => {
        bufferErr += chunk;
      });
    });

    return response;
  }

  async run(
    event: RuntimeEvent,
    options: ExecutionOptions,
  ): Promise<[string, string]> {
    this.assertRunning(false);

    // First restore from checkpoint.
    await this.startFromCheckpoint();

    // Now that we are runnning, remove the checkpoint.
    await this.removeCheckpoint();

    // Then communicate with the container.
    const response = await this.emitEvent(event, options);

    // We need to do some checks.
    const info = await this.inner.inspect({
      _query: { size: true },
      _body: {},
    });
    // The container must not use up too much disk space.
    if (info.SizeRw > 128 * 1024 * 1024) {
      throw new ContainerError('Container used too much disk space.');
    }

    await this.checkpoint();
    return response;
  }

  async upload(content: string, filename: string, path: string) {
    // Archive the content.
    const archive = tar.pack();
    archive.entry({ name: filename }, content);
    archive.finalize();
    await this.inner.putArchive(archive, { path });
  }

  // Create a container from the source code of a yqrt program.
  static async Create(
    docker: Docker,
    source: string,
    metadata: ContainerMetadata,
    options: ExecutionOptions,
  ): Promise<[Container, [string, string]]> {
    const inner = await docker.createContainer(getConfig(metadata));
    // Newly created container is guaranteed to not be running.
    const wrapped = new Container(inner, false, metadata);

    try {
      // Start the container.
      await wrapped.start();

      // Upload the source code.
      await wrapped.upload(source, 'yqprogram.cpp', '/app/');

      // Tell the container to stop waiting.
      const [started] = await wrapped.emitEvent(
        { type: 'start', data: '' },
        options,
      );
      if (started !== 'started') {
        throw new ContainerError('Script is bad.');
      }

      // Now the script compiles the source code and runs the program.

      // Send an init event.
      const initialResponse = await wrapped.emitEvent(
        { type: 'init', data: '' },
        options,
      );

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

export const getAllContainers = async (
  docker: Docker,
): Promise<Container[]> => {
  const allContainers = await docker.listContainers({ all: true });
  const yqrtContainers = allContainers.filter(({ Labels }) =>
    isYqrtContainer(Labels),
  );
  return await Promise.all(
    yqrtContainers.map(({ Id }) => Container.Connect(docker, Id)),
  );
};
