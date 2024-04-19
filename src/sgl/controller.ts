import { $, Context, Session } from 'koishi';

import { createChannelwiseStorage } from '../channelwise';
import HashIndex, {
  HashIndexExempts,
  Hash as HashIndexHash,
  HashIndexHashes,
} from './HashIndex';
import { AntiRecallMeta, Candidate, Image, State } from './model';
import { Ranking, SglOrigin } from './schema';

export type Torture = {
  image: Image;
  origin: SglOrigin;
};

export type TortureData = {
  index: number;
  date: Date;
  nickname: string;
  originId: number;
};

// Handle database operations.
export class Controller {
  constructor(
    private readonly ctx: Context,
    private readonly channelKey: string,
    private readonly state: State,
  ) {}

  processImages(images: Image[], tolerance: number): Promise<Candidate[]> {
    return this.state.processImages(images, tolerance);
  }

  private async insertOrigin(
    hash: HashIndexHash,
    { userId, timestamp }: Session,
  ) {
    const { id } = await this.ctx.database.create('sglOrigin', {
      channelKey: this.channelKey,
      hash: hash.toString(),
      senderId: userId,
      timestamp,
      exempt: false,
    });
    this.state.index.insert({ key: id, hash });
  }

  // Add a record to the database, and look up the origin.
  private async addRecordAndQueryOrigin(
    originId: number,
    { userId, timestamp }: Session,
  ): Promise<SglOrigin> {
    const recordPromise = this.ctx.database.create('sglRecord', {
      channelKey: this.channelKey,
      originId,
      userId,
      timestamp,
    });
    const originPromise = this.ctx.database.get('sglOrigin', originId);
    // We have interleaved the two promises.
    await recordPromise;
    const [origin] = await originPromise;
    return origin;
  }

  async generateTortures(
    candidates: Candidate[],
    session: Session,
  ): Promise<[Torture[], AntiRecallMeta]> {
    // First categorize.
    const { insert, torture, antiRecall } =
      this.state.generateTortures(candidates);
    // Insertions.
    const insertionsPromises: Promise<void>[] = insert.map(({ result }) =>
      this.insertOrigin(result.hash, session),
    );
    // Tortures.
    const torturesPromises: Promise<Torture>[] = torture.map(
      ({ image, result }) =>
        this.addRecordAndQueryOrigin(result.key, session).then((origin) => ({
          image,
          origin,
        })),
    );
    const antiRecallMeta = { userId: session.userId, images: antiRecall };
    // Now synchronize.
    await Promise.all(insertionsPromises);
    const tortures = await Promise.all(torturesPromises);
    return [tortures, antiRecallMeta];
  }

  // If there are tortures, we should give user a chance to ignore.
  resetIgnore(torturesData: TortureData[]) {
    this.state.ignore.reset(
      torturesData.map(({ index, originId }) => [index, originId]),
    );
  }

  // Anti-recall
  resetAntiRecall(messageId: string, antiRecall: AntiRecallMeta) {
    this.state.antiRecall.set(messageId, antiRecall);
    // Expire in 5 minutes
    this.ctx.setTimeout(
      () => this.state.antiRecall.delete(messageId),
      1000 * 60 * 5,
    );
  }

  // Returns the originId.
  popIgnore(index?: number): number {
    return this.state.ignore.pop(index);
  }

  checkAntiRecall(messageId: string): AntiRecallMeta | null {
    if (!this.state.antiRecall.has(messageId)) {
      return null;
    }
    const antiRecall = this.state.antiRecall.get(messageId)!;
    this.state.antiRecall.delete(messageId);
    return antiRecall;
  }

  async setExempt(originId: number) {
    this.state.index.setExempt(originId);
    await this.ctx.database.set('sglOrigin', originId, {
      exempt: true,
    });
  }

  async rankings(fromDate: number): Promise<Ranking[]> {
    return await this.ctx.database
      .select('sglRecord')
      .where((row) =>
        $.and(
          $.eq(row.channelKey, this.channelKey),
          $.gte(row.timestamp, fromDate),
        ),
      )
      .groupBy('userId', {
        count: (row) => $.count(row.id),
      })
      .orderBy('count', 'desc')
      .execute();
  }
}

// Read from database.
export const initializeStates = async (ctx: Context) => {
  type Origins = {
    hashes: HashIndexHashes;
    exempts: HashIndexExempts;
  };
  const storage = createChannelwiseStorage(
    await ctx.database.select('sglOrigin').execute(),
    State,
    ({ hashes, exempts }: Origins, origin: SglOrigin): undefined => {
      hashes.set(origin.id, BigInt(origin.hash));
      if (origin.exempt) {
        exempts.add(origin.id);
      }
    },
    () => ({ hashes: new Map(), exempts: new Set() }),
    ({ hashes, exempts }: Origins): State =>
      new State(new HashIndex(hashes, exempts)),
  );
  return storage.withController(ctx, Controller);
};
