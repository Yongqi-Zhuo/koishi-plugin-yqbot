import Docker from 'dockerode';

import { ExecutionOptions, RuntimeEvent } from './common';
import Container from './container';
import { ContainerMetadata, CurrentVersion } from './schema';

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

export type ResultRemove = {};

export type ResultRun = {
  response: string;
  error: string;
};

export class State {
  private readonly containers: Map<string, Container> = new Map();
  constructor(private readonly options: DockerOptions) {}

  accumulate(container: Container) {
    this.containers.set(container.id, container);
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
    this.containers.set(container.id, container);
    return { id: container.id, initialResponse };
  }

  async remove(id: string, force: boolean): Promise<ResultRemove> {
    const container = this.containers.get(id);
    if (container === undefined) {
      throw new Error(`container ${id} not found`);
    }
    await container.remove(force);
    this.containers.delete(id);
    return {};
  }

  async run(id: string, event: RuntimeEvent): Promise<ResultRun> {
    const container = this.containers.get(id);
    if (container === undefined) {
      throw new Error(`container ${id} not found`);
    }
    try {
      const [response, error] = await container.run(
        event,
        this.options.runOptions,
      );
      return { response, error };
    } catch (error) {
      // Something bad happened.
      // We had better remove the container.
      await this.remove(id, true);
      throw error;
    }
  }

  list(): string[] {
    return Array.from(this.containers.keys());
  }

  has(id: string): boolean {
    return this.containers.has(id);
  }
}
