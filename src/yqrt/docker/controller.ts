import Docker from 'dockerode';
import { Context } from 'koishi';

import { createChannelwiseStorage } from '../../channelwise';
import { Mutex, Queue } from '../../utils';
import { ExecutionOptions, RuntimeEvent } from './common';
import Container, { getAllContainers } from './container';
import { State } from './model';
import { ContainerMetadata, KeyedContainerMetadata } from './schema';

export type ResultCreate = {
  id: string;
  initialResponse: string;
};

export type ResultRemove = {
  id: string;
};

export type ResultInvoke = {
  id: string;
  kind: 'success';
  response: string;
  error: string;
};

export type ErrorInvoke = {
  id: string;
  kind: 'error';
  exception: Error;
};

export type ResultEvent = (ResultInvoke | ErrorInvoke)[];

class Extra {
  mutex: Mutex = new Mutex();
  consecutiveErrors: number = 0;
  async lock<T>(callback: () => Promise<T>): Promise<T> {
    this.consecutiveErrors += 1;
    const result = await this.mutex.with(callback);
    this.consecutiveErrors = 0;
    return result;
  }
}

export type ContainerDetails = {
  consecutiveErrors: number;
} & KeyedContainerMetadata;

export class Controller {
  constructor(
    private readonly ctx: Context,
    private readonly queue: Queue,
    public readonly state: State,
    private readonly compileOptions: ExecutionOptions,
    private readonly runOptions: ExecutionOptions,
    private readonly maxConsecutiveErrors: number,
  ) {}

  find(abbr: string): string {
    return this.state.find(abbr).id;
  }

  private extras: Map<string, Extra> = new Map();
  private getExtra(id: string) {
    if (!this.extras.has(id)) {
      this.extras.set(id, new Extra());
    }
    return this.extras.get(id)!;
  }

  // This serves for multiple purposes:
  //  - Lock with a mutex to ensure there is no racing condition on a single container.
  //  - Keep track of consecutive errors to prevent indefinite retries.
  private withContainer<T>(
    abbr: string,
    callback: (container: Container) => Promise<T>,
  ): Promise<T> {
    const container = this.state.find(abbr);
    const extra = this.getExtra(container.id);
    return extra.lock(() => callback(container));
  }

  create(
    source: string,
    metadata: Omit<ContainerMetadata, 'version'>,
  ): Promise<ResultCreate> {
    return this.queue.with(async () => {
      const { container, initialResponse } = await this.state.create(
        source,
        metadata,
        this.compileOptions,
      );
      return { id: container.id, initialResponse };
    });
  }

  remove(abbr: string, force: boolean): Promise<ResultRemove> {
    return this.queue.with(() =>
      this.withContainer(abbr, async (container) => {
        await this.state.remove(container, force);
        return { id: container.id };
      }),
    );
  }

  invoke(abbr: string, event: RuntimeEvent): Promise<ResultInvoke> {
    return this.queue.with(() =>
      this.withContainer(abbr, async (container) => {
        const { response, error } = await this.state.run(
          container,
          event,
          this.runOptions,
        );
        return { id: container.id, kind: 'success', response, error };
      }),
    );
  }

  inspect(abbr: string) {
    return this.state.inspect(this.state.find(abbr));
  }

  list() {
    return this.state.list().map((metadata) => ({
      ...metadata,
      consecutiveErrors: this.getExtra(metadata.id).consecutiveErrors,
    }));
  }

  // No throw.
  event(event: RuntimeEvent): Promise<ResultEvent> {
    const programs = this.list();
    return Promise.all(
      programs
        .filter(
          // Do not auto invoke if there are too many errors.
          ({ consecutiveErrors }) =>
            consecutiveErrors <= this.maxConsecutiveErrors,
        )
        .map(async ({ id }) => {
          try {
            const { response, error } = await this.invoke(id, event);
            this.ctx.logger.info(
              `on message ${id}, response: ${JSON.stringify(response)}, error: ${JSON.stringify(error)}`,
            );
            return { id, kind: 'success', response, error };
          } catch (exception) {
            return { id, kind: 'error', exception };
          }
        }),
    );
  }
}

export const initializeStates = async (
  ctx: Context,
  docker: Docker,
  queue: Queue,
  compileOptions: ExecutionOptions,
  runOptions: ExecutionOptions,
  maxConsecutiveErrors: number,
) => {
  const containers = await getAllContainers(docker);
  return createChannelwiseStorage(
    containers,
    () => new State(docker),
  ).withController(
    (channelKey, state) =>
      new Controller(
        ctx,
        queue,
        state,
        compileOptions,
        runOptions,
        maxConsecutiveErrors,
      ),
  );
};
