// Use 'start' and 'stop' to control the lifecycle of the manager.
export default class Queue {
  // semaphore + # of running tasks == concurrency
  private semaphore: number = 0;
  // queue.length == # of pending tasks
  private queue: (() => void)[] = [];

  // On incoming task, we first try to run it by decrementing semaphore.
  //   If this fails, we enqueue the task.
  // When a task is done, we dequeue the next task if there is any.
  //   If there is no pending task in the queue, we increment semaphore.

  constructor(
    // Number of concurrent tasks.
    private readonly concurrency: number,
  ) {
    if (this.concurrency <= 0 || !Number.isInteger(this.concurrency)) {
      throw new Error('concurrency must be a positive integer');
    }
  }

  // Return a promise that can be awaited before we enter execution.
  // When the promise is resolved, we enter the critical section.
  private enqueue(): Promise<void> {
    // If there is spare concurrency, we can run the task immediately.
    if (this.semaphore > 0) {
      this.semaphore -= 1;
      return Promise.resolve();
    } else {
      // Otherwise, we enqueue the task.
      return new Promise((resolve) => {
        this.queue.push(resolve);
      });
    }
  }

  // Leave the critical section.
  private dequeue() {
    // If there is a pending task, we run it.
    const resolve = this.queue.shift();
    if (resolve !== undefined) {
      resolve();
    } else {
      // Otherwise, we increment semaphore.
      this.semaphore += 1;
    }
  }

  // Rate-limit the number of concurrent tasks.
  async process<R>(task: Promise<R>): Promise<R> {
    await this.enqueue();
    try {
      return await task;
    } finally {
      this.dequeue();
    }
  }

  private status: 'off' | 'running' | 'stopping' | 'stopped' = 'off';

  // Start the manager.
  start() {
    if (this.status !== 'off') {
      throw new Error(`Queue cannot start because it is ${this.status}`);
    }
    this.status = 'running';
    // Start pending tasks.
    for (let i = 0; i < this.concurrency; i++) {
      this.dequeue();
    }
  }

  // Stop the manager.
  // Returns a promise that resolves when all tasks are done.
  stop(): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Queue cannot stop because it is ${this.status}`);
    }
    this.status = 'stopping';
    return (async () => {
      // Wait for all tasks to be done.
      for (let i = 0; i < this.concurrency; i++) {
        await this.enqueue();
      }
      this.status = 'stopped';
    })();
  }
}
