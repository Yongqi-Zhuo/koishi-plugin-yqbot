import Docker from 'dockerode';
import _ from 'underscore';

import { ExecutionOptions, RuntimeEvent } from './common';
import Container from './container';
import {
  ContainerMetadata,
  CurrentVersion,
  KeyedContainerMetadata,
} from './schema';

export class State {
  // The containers and the locks.
  private readonly containers: Map<string, Container> = new Map();
  constructor(private readonly docker: Docker) {}

  accumulate(container: Container) {
    this.containers.set(container.id, container);
  }

  find(abbr: string): Container {
    let candidate: Container | undefined;
    // The supplied abbr may be a prefix of the hash, or just the title.
    for (const [id, container] of this.containers.entries()) {
      if (id.startsWith(abbr) || container.metadata.title === abbr) {
        if (candidate !== undefined) {
          throw new Error(
            `Ambiguous abbreviation ${abbr}: ${candidate.id} vs ${id}`,
          );
        }
        candidate = container;
      }
    }
    if (candidate === undefined) {
      throw new Error(`Container ${abbr} not found`);
    }
    return candidate;
  }

  async create(
    source: string,
    metadata: Omit<ContainerMetadata, 'version'>,
    options: ExecutionOptions,
  ) {
    // Ignore stderr.
    const [container, [initialResponse]] = await Container.Create(
      this.docker,
      source,
      { version: CurrentVersion, ...metadata },
      options,
    );
    this.accumulate(container);
    return { container, initialResponse };
  }

  async remove(container: Container, force: boolean) {
    await container.remove(force);
    this.containers.delete(container.id);
  }

  async run(
    container: Container,
    event: RuntimeEvent,
    options: ExecutionOptions,
  ) {
    const [response, error] = await container.run(event, options);
    return { response, error };
  }

  inspect(container: Container): KeyedContainerMetadata {
    return { id: container.id, ...container.metadata };
  }

  list(): KeyedContainerMetadata[] {
    return Array.from(this.containers.entries(), ([id, container]) => ({
      id,
      ...container.metadata,
    }));
  }
}
