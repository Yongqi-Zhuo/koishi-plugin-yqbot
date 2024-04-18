import Docker from 'dockerode';
import EventEmitter from 'events';
import { Context } from 'koishi';

import type { DistributiveOmit } from '../../utils';
import Container from './container';
import { CreationResult, ExecutionOptions, RuntimeEvent, Task } from './model';

// Use 'start' and 'close' to control the lifecycle of the manager.
export class Manager extends EventEmitter {
  private readonly queue: Task[] = [];
  private semaphore: number;
  // false -> not closed
  // some function -> closing
  // true -> closed
  private closed: (() => void) | boolean = false;
  constructor(
    ctx: Context,
    private readonly docker: Docker,
    // Number of concurrent tasks.
    private readonly concurrency: number,
    private readonly compileOptions: ExecutionOptions,
    private readonly runOptions: ExecutionOptions,
  ) {
    super();
    this.semaphore = this.concurrency;

    this.on('start', async () => {
      await this.guardedProcess();
    });

    this.on('close', async (resolve: () => void) => {
      if (this.closed !== false) {
        throw new Error('Cannot close the manager twice.');
      }
      this.closed = resolve;
      await this.guardedProcess();
    });

    this.on('task', async (task: Task) => {
      this.queue.push(task);
      await this.guardedProcess();
    });

    this.on('error', (error: Error) => {
      ctx.logger.error('Error during manager event loop:', error);
    });
  }

  private async guardedProcess() {
    if (this.semaphore > 0) {
      this.semaphore -= 1;
      try {
        while (this.queue.length > 0) {
          await this.process();
        }
      } finally {
        this.semaphore += 1;
        if (
          // We are closing.
          typeof this.closed === 'function' &&
          // All tasks done.
          this.queue.length === 0 &&
          // We are the last thread.
          this.semaphore === this.concurrency
        ) {
          this.closed();
          this.closed = true;
        }
      }
    }
  }

  private async process() {
    const task = this.queue.shift();
    try {
      switch (task.kind) {
        case 'create': {
          const [container, initialResponse] = await Container.Create(
            this.docker,
            task.source,
            this.compileOptions,
          );
          task.resolve({ id: container.id, initialResponse });
          break;
        }
        case 'remove': {
          const container = await Container.Connect(this.docker, task.id);
          await container.remove(task.force);
          task.resolve();
          break;
        }
        case 'run': {
          const container = await Container.Connect(this.docker, task.id);
          const response = await container.run(task.event, this.runOptions);
          task.resolve(response);
          break;
        }
      }
    } catch (error) {
      task.reject(error);
    }
  }

  start(): void {
    this.emit('start');
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.emit('close', resolve);
    });
  }

  private enqueue<Result>(
    task: DistributiveOmit<Task, 'resolve' | 'reject'>,
  ): Promise<Result> {
    if (this.closed !== false) {
      return Promise.reject(new Error('Cannot enqueue task after closing.'));
    }
    return new Promise((resolve, reject) => {
      this.emit('task', { ...task, resolve, reject });
    });
  }

  create(source: string): Promise<CreationResult> {
    return this.enqueue({ kind: 'create', source });
  }

  remove(id: string, force: boolean): Promise<void> {
    return this.enqueue({ kind: 'remove', id, force });
  }

  run(id: string, event: RuntimeEvent): Promise<string> {
    return this.enqueue({ kind: 'run', id, event });
  }
}
