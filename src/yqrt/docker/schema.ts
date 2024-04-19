export const CurrentVersion = 1;

export type ContainerMetadata = {
  version: number;
  channelKey: string;
  author: string;
  timestamp: number;
};

export type ContainerLabels = Record<string, string>;

export const containerMetadataToLabels = (
  metadata: ContainerMetadata,
): ContainerLabels => ({
  'yqrt.version': metadata.version.toString(),
  'yqrt.channelKey': metadata.channelKey,
  'yqrt.author': metadata.author,
  'yqrt.timestamp': metadata.timestamp.toString(),
});

export const isYqrtContainer = (labels: ContainerLabels): boolean =>
  'yqrt.version' in labels;

export const containerMetadataFromLabels = (
  labels: ContainerLabels,
): ContainerMetadata => {
  if (labels['yqrt.version'] !== CurrentVersion.toString()) {
    // Migration is supported.
    throw new Error('Unsupported schema version.');
  }
  return {
    version: parseInt(labels['yqrt.version']),
    channelKey: labels['yqrt.channelKey'],
    author: labels['yqrt.author'],
    timestamp: parseInt(labels['yqrt.timestamp']),
  };
};

export type KeyedContainerMetadata = {
  id: string;
} & ContainerMetadata;
