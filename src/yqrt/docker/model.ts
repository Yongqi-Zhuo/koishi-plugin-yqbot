import { ContainerItem } from './schema';

export type RuntimeEvent = {
  type: string;
  data: string;
};

export type ExecutionOptions = {
  timeout: number;
};

export const encodeEvent = (event: RuntimeEvent): Buffer => {
  const dataBuffer = Buffer.from(event.data);
  const len = dataBuffer.length;
  const headerBuffer = Buffer.from(`${event.type} ${len}\n`);
  return Buffer.concat([headerBuffer, dataBuffer]);
};

export type TaskKind = 'create' | 'remove' | 'run';

export type CreationResult = {
  id: string;
  initialResponse: string;
};

export type TaskCreate = {
  kind: 'create';
  source: string;
  resolve: (result: CreationResult) => void;
  reject: (error: Error) => void;
};

export type TaskRemove = {
  kind: 'remove';
  id: string;
  force: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

export type TaskRun = {
  kind: 'run';
  id: string;
  event: RuntimeEvent;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
};

export type Task = TaskCreate | TaskRemove | TaskRun;

export class State {
  private readonly containers: Set<string> = new Set();
  constructor() {}
  accumulate({ id }: ContainerItem) {
    this.containers.add(id);
  }
}
