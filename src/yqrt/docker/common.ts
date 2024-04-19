export const ImageName = 'yqbot-yqrt';

export const CheckpointKey = 'paused';

export const EscapeSequence = '\x07';

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
