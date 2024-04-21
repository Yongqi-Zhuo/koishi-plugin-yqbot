// On incoming task, we first try to run it by decrementing semaphore.
//   If this fails, we enqueue the task.
// When a task is done, we dequeue the next task if there is any.
//   If there is no pending task in the queue, we increment semaphore.
export default class Semaphore {
  // queue.length == # of pending tasks
  private queue: (() => void)[] = [];
  constructor(
    // semaphore + # of running tasks == concurrency
    private semaphore: number,
  ) {
    if (!Number.isInteger(this.semaphore)) {
      throw new Error('semaphore must be an integer');
    }
  }

  // Return a promise that can be awaited before we enter execution.
  // When the promise is resolved, we enter the critical section.
  acquire(): Promise<void> {
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
  release() {
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
  async with<R>(task: () => Promise<R>): Promise<R> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
