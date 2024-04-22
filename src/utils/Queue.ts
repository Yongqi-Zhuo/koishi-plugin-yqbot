import Semaphore from './Semaphore';

// Use 'start' and 'stop' to control the lifecycle of the queue.
export default class Queue extends Semaphore {
  constructor(
    // Number of concurrent tasks.
    private readonly concurrency: number,
  ) {
    // We first set semaphore to 0, and later increment it to the concurrency.
    super(0);
    if (this.concurrency <= 0 || !Number.isInteger(this.concurrency)) {
      throw new Error('concurrency must be a positive integer');
    }
  }

  private status: 'off' | 'running' | 'stopping' | 'stopped' = 'off';

  // Start the queue.
  start() {
    if (this.status !== 'off') {
      throw new Error(`Queue cannot start because it is ${this.status}`);
    }
    this.status = 'running';
    // Start pending tasks.
    for (let i = 0; i < this.concurrency; i++) {
      this.release();
    }
  }

  // Stop the queue.
  // Returns a promise that resolves when all tasks are done.
  stop(): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Queue cannot stop because it is ${this.status}`);
    }
    this.status = 'stopping';
    return (async () => {
      // Wait for all tasks to be done.
      for (let i = 0; i < this.concurrency; i++) {
        await this.acquire();
      }
      this.status = 'stopped';
    })();
  }
}
