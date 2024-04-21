export const CurrentVersion = 1;

export type ContainerMetadata = {
  version: number;
  channelKey: string;
  language: string;
  title: string;
  source: string;
  author: string;
  timestamp: number;
};

export type KeyedContainerMetadata = ContainerMetadata & { id: string };

export type ContainerLabels = Record<string, string>;

export const containerMetadataToLabels = (
  metadata: ContainerMetadata,
): ContainerLabels => ({
  'yqrt.version': metadata.version.toString(),
  'yqrt.channelKey': metadata.channelKey,
  'yqrt.language': metadata.language,
  'yqrt.title': metadata.title,
  'yqrt.source': metadata.source,
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
    language: labels['yqrt.language'],
    title: labels['yqrt.title'],
    source: labels['yqrt.source'],
    author: labels['yqrt.author'],
    timestamp: parseInt(labels['yqrt.timestamp']),
  };
};
