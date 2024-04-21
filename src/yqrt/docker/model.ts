import Docker from 'dockerode';
import _ from 'underscore';

import { createChannelwiseStorage } from '../../channelwise';
import Mutex from './Mutex';
import { ExecutionOptions, RuntimeEvent } from './common';
import Container, { getAllContainers } from './container';
import {
  ContainerMetadata,
  CurrentVersion,
  KeyedContainerMetadata,
} from './schema';

export type DockerOptions = {
  docker: Docker;
  compileOptions: ExecutionOptions;
  runOptions: ExecutionOptions;
};

export type TaskKind = 'create' | 'remove' | 'run';

export type ResultCreate = {
  id: string;
  initialResponse: string;
};

export type ResultRemove = {
  id: string;
};

export type ResultRun = {
  id: string;
  response: string;
  error: string;
};

export class State {
  // The containers and the locks.
  private readonly containers: Map<string, [Container, Mutex]> = new Map();
  constructor(private readonly options: DockerOptions) {}

  accumulate(container: Container) {
    this.containers.set(container.id, [container, new Mutex()]);
  }

  find(abbr: string): string {
    let candidate: string | undefined;
    // The supplied abbr may be a prefix of the hash, or just the title.
    for (const [
      id,
      [
        {
          metadata: { title },
        },
      ],
    ] of this.containers.entries()) {
      if (id.startsWith(abbr) || title === abbr) {
        if (candidate !== undefined) {
          throw new Error(
            `Ambiguous abbreviation ${abbr}: ${candidate} vs ${id}`,
          );
        }
        candidate = id;
      }
    }
    if (candidate === undefined) {
      throw new Error(`Container ${abbr} not found`);
    }
    return candidate;
  }

  private withContainer<T>(
    abbr: string,
    callback: (container: Container) => Promise<T>,
  ): Promise<T> {
    const id = this.find(abbr);
    const [container, mutex] = this.containers.get(id)!;
    return mutex.with(() => callback(container));
  }

  async create(
    source: string,
    metadata: Omit<ContainerMetadata, 'version'>,
  ): Promise<ResultCreate> {
    // Ignore stderr.
    const [container, [initialResponse]] = await Container.Create(
      this.options.docker,
      source,
      { version: CurrentVersion, ...metadata },
      this.options.compileOptions,
    );
    this.accumulate(container);
    return { id: container.id, initialResponse };
  }

  remove(abbr: string, force: boolean): Promise<ResultRemove> {
    return this.withContainer(abbr, async (container) => {
      const id = container.id;
      await container.remove(force);
      this.containers.delete(id);
      return { id };
    });
  }

  run(abbr: string, event: RuntimeEvent): Promise<ResultRun> {
    return this.withContainer(abbr, async (container) => {
      const id = container.id;
      try {
        const [response, error] = await container.run(
          event,
          this.options.runOptions,
        );
        return { id, response, error };
      } catch (error) {
        // Something bad happened.
        // We had better remove the container.
        await container.remove(true);
        this.containers.delete(id);
        throw new Error(
          `Failed to run container ${id} due to error: ${error}\nContainer is removed.`,
        );
      }
    });
  }

  inspect(abbr: string): KeyedContainerMetadata {
    const id = this.find(abbr);
    const [container] = this.containers.get(id)!;
    return { id, ...container.metadata };
  }

  list(): KeyedContainerMetadata[] {
    return Array.from(this.containers.entries(), ([id, [container]]) => ({
      id,
      ...container.metadata,
    }));
  }
}

export const initializeStates = async (
  docker: Docker,
  compileOptions: ExecutionOptions,
  runOptions: ExecutionOptions,
) => {
  const containers = await getAllContainers(docker);
  const dockerOptions = {
    docker,
    compileOptions,
    runOptions,
  };
  return createChannelwiseStorage(containers, () => new State(dockerOptions));
};
