import { Logger } from 'koishi';
import HashIndex, {
  QueryResult,
  QueryResultFound,
  QueryResultNone,
} from './HashIndex';
import { hashToBinaryString } from './common';
import download from './download';
import phash from './phash';

const logger = new Logger('sgl-model');

// The images filtered for query by the frontend.
export type Image = {
  index: number;
  src: string;
};

// The images that have been downloaded and looked up.
export type Candidate = {
  image: Image;
  result: QueryResult;
};

export type NoneCandidate = {
  image: Image;
  result: QueryResultNone;
};

export type FoundCandidate = {
  image: Image;
  result: QueryResultFound;
};

export type Actions = {
  insert: NoneCandidate[];
  torture: FoundCandidate[];
  antiRecall: Image[];
};

export class IgnoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IgnoreError';
  }
}

export class Ignore {
  private readonly value: Map<number, number> = new Map();
  // [index, originId][]
  reset(originIds: [number, number][]) {
    this.value.clear();
    for (const [index, originId] of originIds) {
      this.value.set(index, originId);
    }
  }
  // Find an originId with an index.
  // If index is not specified, assume there is only one originId.
  pop(index?: number): number {
    if (index) {
      const originId = this.value.get(index);
      if (originId) {
        this.value.delete(index);
        return originId;
      } else {
        throw new IgnoreError(`序号为 ${index} 的图片不存在。`);
      }
    }
    if (this.value.size === 0) {
      throw new IgnoreError('没有可以忽略的图片。');
    } else if (this.value.size > 1) {
      throw new IgnoreError('请指定要忽略的图片序号。');
    }
    const [[, originId]] = Array.from(this.value);
    this.value.clear();
    return originId;
  }
}

export type AntiRecallMeta = {
  userId: string;
  images: Image[];
};

export class State {
  index: HashIndex;
  // index -> originId
  ignore: Ignore = new Ignore();
  // message id -> image urls
  antiRecall: Map<string, AntiRecallMeta> = new Map();

  constructor(index?: HashIndex) {
    this.index = index || new HashIndex(new Map(), new Set());
  }

  async processImages(
    images: Image[],
    tolerance: number,
  ): Promise<Candidate[]> {
    const candidatesPromises: Promise<Candidate | null>[] = images.map(
      (image) =>
        download(image.src)
          .then(phash)
          .then((hash) => ({
            image,
            result: this.index.query(hash, tolerance),
          }))
          .catch((e) => {
            logger.error('Failed to download image:', e);
            return null;
          }),
    );
    // Now all the downloads and the queries are in progress.
    // Wait for them to complete.
    const candidates = await Promise.all(candidatesPromises);
    // Filter out failed downloads.
    return candidates.filter(
      (candidate): candidate is Candidate => candidate !== null,
    );
  }

  // If this is original, insert. If this is similar, record and torture.
  generateTortures(candidates: Candidate[]): Actions {
    const insert: NoneCandidate[] = [];
    const torture: FoundCandidate[] = [];
    const antiRecall: Image[] = [];
    for (const candidate of candidates) {
      const { image, result } = candidate;
      switch (result.kind) {
        case 'none':
          logger.info(
            `No similar image found for image #${image.index}, with hash ${hashToBinaryString(result.hash)}.`,
          );
          // Insert into database without awaiting.
          insert.push(candidate as NoneCandidate);
          break;
        case 'exempt':
          logger.info(
            `Exempted image found for image #${image.index}, with hash ${hashToBinaryString(result.hash)}.`,
          );
          break;
        case 'found':
          logger.info(
            `Similar image found for image #${image.index}, with hash ${hashToBinaryString(result.hash)}.`,
          );
          // Point this out later. To do this, we must:
          //  query from database the origin, and
          //  record user information.
          torture.push(candidate as FoundCandidate);
          // Anti-recall.
          antiRecall.push(image);
          break;
      }
    }
    return { insert, torture, antiRecall };
  }
}
