import Docker, { ContainerStartOptions } from 'dockerode';
import fs from 'fs';
import { PassThrough } from 'stream';

import { makeTempDir } from '../common';
import { Event, ImageName } from './common';

const CheckpointKey = 'paused';

const EscapeSequence = '\x07';

type ExecutionOptions = {
  timeout: number;
};

async function pauseContainer(container: Docker.Container) {
  // Create a checkpoint and exit.
  await (container as any).createCheckpoint({
    checkpointId: CheckpointKey,
    exit: true,
  });
}

async function restartContainer(container: Docker.Container) {
  // Start the container from the checkpoint.
  await container.start({
    _query: { checkpoint: CheckpointKey },
    _body: {},
  } as ContainerStartOptions);
  // Remove the checkpoint.
  await (container as any).deleteCheckpoint(CheckpointKey);
}

function encodeEvent(event: Event): Buffer {
  const dataBuffer = Buffer.from(event.data);
  const len = dataBuffer.length;
  const headerBuffer = Buffer.from(`${event.type} ${len}\n`);
  return Buffer.concat([headerBuffer, dataBuffer]);
}

async function emitEvent(
  container: Docker.Container,
  event: Event,
  options: ExecutionOptions,
): Promise<string> {
  const streamWrite = await container.attach({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true,
  });
  const streamReadOut = new PassThrough();
  const streamReadErr = new PassThrough();
  container.modem.demuxStream(streamWrite, streamReadOut, streamReadErr);

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
      () => reject(new Error('Execution timed out')),
      options.timeout,
    );
    streamReadOut.on('data', (chunk: string) => {
      const end = chunk.indexOf(EscapeSequence);
      if (end !== -1) {
        clearTimeout(timer);
        if (end !== chunk.length - 1) {
          return reject(
            new Error('Slave should send no more than one escape sequence'),
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

export async function runContainer(
  docker: Docker,
  containerId: string,
  event: Event,
  options: ExecutionOptions,
): Promise<string> {
  const container = docker.getContainer(containerId);
  await restartContainer(container);
  const response = await emitEvent(container, event, options);
  await pauseContainer(container);
  return response;
}

// Create a container from the source code of a yqrt program.
export async function createContainer(
  docker: Docker,
  source: string,
  options: ExecutionOptions,
): Promise<string> {
  const tempDir = await makeTempDir();
  // Dump the source code to a file
  await fs.promises.writeFile(`${tempDir}/yqprogram.cpp`, source);
  const container = await docker.createContainer({
    HostConfig: {
      Binds: [`${tempDir}:/mnt`],
    },
    Image: ImageName,
    Tty: false,
    OpenStdin: true,
  });

  // This should compile the source code and run the program.
  try {
    await container.start();
    // TODO: pass the response back to the caller
    const initialResp = await emitEvent(
      container,
      { type: 'init', data: '' },
      options,
    );
  } catch (error) {
    await container.remove({ force: true });
    throw error;
  }

  // We should check if compilation failed.
  // The executable is expected to be in ${tempDir}/yqprogram.
  const stats = await fs.promises.stat(`${tempDir}/yqprogram`);
  if (!stats.isFile()) {
    await container.remove({ force: true });
    throw new Error('Compilation failed.');
  }

  // Pause the container.
  await pauseContainer(container);

  return container.id;
}

export async function removeContainer(docker: Docker, containerId: string) {
  const container = docker.getContainer(containerId);
  await container.remove();
}
