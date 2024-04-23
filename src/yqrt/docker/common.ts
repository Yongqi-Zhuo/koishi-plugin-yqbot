export const ImageName = 'yqbot-yqrt';

export const CheckpointKey = 'paused';

export const EscapeSequence = '\x07';

export type RuntimeEvent = {
  kind: string;
};

export type RuntimeEventInit = {
  kind: 'init';
};

export type RuntimeEventMessage = {
  kind: 'message';
  author: number;
  timestamp: number;
  text: string;
};

export type ExecutionOptions = {
  timeout: number;
};

export const encodeEvent = <E extends RuntimeEvent>(event: E): Buffer => {
  return Buffer.from(JSON.stringify(event) + '\n');
};
