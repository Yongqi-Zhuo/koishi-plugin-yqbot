import Semaphore from './Semaphore';

export default class Mutex extends Semaphore {
  constructor() {
    super(1);
  }
}
