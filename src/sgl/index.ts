import { Context, Schema, Session, h } from 'koishi';
import {} from 'koishi-plugin-adapter-onebot';
import { zip } from '../utils';
import HashIndex, {
  HashIndexExempts,
  Hash as HashIndexHash,
  HashIndexHashes,
  QueryResult,
} from './HashIndex';
import download from './download';
import phash from './phash';
import assert from 'assert';
import { hashToBinaryString } from './common';

export const name = 'sgl';

export const inject = ['database'];

export interface Config {
  tolerance: number;
}

export const Config: Schema<Config> = Schema.object({
  tolerance: Schema.number()
    .min(0)
    .max(7)
    .step(1)
    .default(3)
    .description(
      'Max difference of DCT hashes for two pictures to be seen as the same.',
    ),
});

enum PicSubType {
  Normal = 0,
  Face = 1,
}

interface PicElement {
  picSubType: PicSubType;
  summary: string;
}

interface RawElement {
  picElement: PicElement | null;
}

declare module 'koishi' {
  interface Tables {
    sglOrigin: SglOrigin;
    sglRecord: SglRecord;
  }
}

interface SglOrigin {
  id: number;
  channelKey: string;
  // No BigInt, so we use string.
  // Because we build up efficient data structure for queries anyway.
  hash: string;
  senderId: string;
  timestamp: number;
  exempt: boolean;
}

const groupOrigins = (origins: SglOrigin[]) => {
  type Origins = {
    hashes: HashIndexHashes;
    exempts: HashIndexExempts;
  };
  const groups = new Map<string, Origins>();
  for (const origin of origins) {
    const key = origin.channelKey;
    if (!groups.has(key)) {
      groups.set(key, { hashes: new Map(), exempts: new Set() });
    }
    const { hashes, exempts } = groups.get(key)!;
    hashes.set(origin.id, BigInt(origin.hash));
    if (origin.exempt) {
      exempts.add(origin.id);
    }
  }
  return groups;
};

interface SglRecord {
  id: number;
  channelKey: string;
  originId: number;
  userId: string;
  timestamp: number;
}

const getChannelKey = (session: Session) => {
  const { platform, selfId, guildId, channelId } = session;
  return `${platform}.${selfId}.${guildId}.${channelId}`;
};

// Handle database operations.
class Handle {
  readonly channelKey: string;
  private readonly ctx: Context;
  private readonly session: Session;
  readonly index: HashIndex;

  constructor(
    channelKey: string,
    ctx: Context,
    session: Session,
    index: HashIndex,
  ) {
    this.channelKey = channelKey;
    this.ctx = ctx;
    this.session = session;
    this.index = index;
  }

  async insertOrigin(hash: HashIndexHash): Promise<undefined> {
    const { userId, timestamp } = this.session;
    const { id } = await this.ctx.database.create('sglOrigin', {
      channelKey: this.channelKey,
      hash: hash.toString(),
      senderId: userId,
      timestamp,
      exempt: false,
    });
    this.index.insert({ key: id, hash });
    return;
  }

  // Add a record to the database, and look up the origin.
  async addRecordAndQueryOrigin(originId: number): Promise<SglOrigin> {
    const { userId, timestamp } = this.session;
    const recordPromise = this.ctx.database.create('sglRecord', {
      channelKey: this.channelKey,
      originId,
      userId,
      timestamp,
    });
    const originPromise = this.ctx.database.get('sglOrigin', originId);
    // Interleave the two promises.
    const [_, origin] = await Promise.all([recordPromise, originPromise]);
    return origin[0];
  }

  async setExempt(originId: number) {
    this.index.setExempt(originId);
    await this.ctx.database.set('sglOrigin', originId, {
      exempt: true,
    });
  }
}

type Torture = { index: number } & SglOrigin;

const getNickname = async (session: Session, userId: string) => {
  try {
    const member = await session.bot.getGuildMember(session.guildId, userId);
    const nick = member.nick;
    if (nick) return nick;
    return member.user!.name!;
  } catch (e) {
    // If this is not a guild member, we have to get the user.
  }
  try {
    const user = await session.bot.getUser(userId);
    return user.nick || user.name || userId;
  } catch (e) {
    return userId;
  }
};

type Candidate = { index: number } & QueryResult;

export async function apply(ctx: Context, config: Config) {
  // HashIndex for each channel.
  const sessionsStates: Map<string, HashIndex> = new Map();
  const getState = (key: string) => {
    if (!sessionsStates.has(key)) {
      sessionsStates.set(
        key,
        new HashIndex(config.tolerance, new Map(), new Set()),
      );
    }
    return sessionsStates.get(key)!;
  };
  const getHandle = (session: Session) => {
    const key = getChannelKey(session);
    const state = getState(key);
    return new Handle(key, ctx, session, state);
  };

  ctx.database.extend(
    'sglOrigin',
    {
      id: { type: 'unsigned', nullable: false },
      channelKey: { type: 'string', nullable: false },
      hash: { type: 'char', nullable: false },
      senderId: { type: 'string', nullable: false },
      timestamp: { type: 'unsigned', nullable: false },
      exempt: { type: 'boolean', nullable: false },
    },
    {
      primary: 'id',
      autoInc: true,
    },
  );
  ctx.database.extend(
    'sglRecord',
    {
      id: { type: 'unsigned', nullable: false },
      channelKey: { type: 'string', nullable: false },
      originId: { type: 'unsigned', nullable: false },
      userId: { type: 'string', nullable: false },
      timestamp: { type: 'unsigned', nullable: false },
    },
    {
      primary: 'id',
      autoInc: true,
      foreign: {
        originId: ['sglOrigin', 'id'],
      },
    },
  );
  // Read from database
  {
    const origins = await ctx.database.select('sglOrigin').execute();
    const groups = groupOrigins(origins);
    for (const [channelKey, { hashes, exempts }] of groups) {
      sessionsStates.set(
        channelKey,
        new HashIndex(config.tolerance, hashes, exempts),
      );
    }
  }

  ctx.on('message', async (session) => {
    // We need to find the HashIndex.
    const handle = getHandle(session);

    const rawElements = (session.onebot as any)?.raw?.elements as
      | RawElement[]
      | undefined;
    if (!rawElements) {
      ctx.logger.error('Enable debug mode to use this plugin.');
      return;
    }
    // OK. Now we are sure debug mode is on. We can distinguish between images and custom faces.

    let counter = 0;
    const candidatesPromises: Promise<Candidate | null>[] = [];
    assert(
      rawElements.length === session.elements.length,
      'Length mismatch between rawElements and elements.',
    );
    for (const [rawElement, e] of zip(rawElements, session.elements)) {
      ctx.logger.debug('received raw:', rawElement);
      if (e.type !== 'img') {
        continue;
      }
      // TODO: handle this in another function.
      const picElement = rawElement.picElement;
      if (!picElement) {
        ctx.logger.error('Raw message does not contain picElement!');
        continue;
      }
      ++counter;

      // Mobile QQ is observed to send custom faces as '[动画表情]' with picSubType = 0, which violates the semantics of picSubType.
      const isCustomFace =
        picElement.summary === '[动画表情]' ||
        picElement.picSubType === PicSubType.Face;
      if (isCustomFace) {
        ctx.logger.info('This IS a custom face:', e);
        // It is usual to send the same custom face multiple times.
        // Do not count them.
        continue;
      } else {
        ctx.logger.info('This is NOT a custom face:', e);
      }
      // Now we have gathered the image.

      // Download
      const index = counter;
      const url = e.attrs.src;
      candidatesPromises.push(
        (async (): Promise<Candidate | null> => {
          let image: Buffer;
          try {
            image = await download(url);
          } catch (e) {
            ctx.logger.error('Failed to download image:', e);
            return null;
          }
          // Hash
          const hash = phash(image);
          const queryResult = handle.index.query(hash);
          return { index, ...queryResult };
        })(),
      );
    }

    // Now all the downloads and the queries are in progress.
    // Wait for them to finish.
    const candidates = (await Promise.all(candidatesPromises)).filter(
      (candidate): candidate is Candidate => candidate !== null,
    );
    const resultsPromises: Promise<Torture | undefined>[] = [];
    for (const candidate of candidates) {
      switch (candidate.kind) {
        case 'none':
          ctx.logger.info(
            `No similar image found for image #${candidate.index}, with hash ${hashToBinaryString(candidate.hash)}.`,
          );
          // Insert into database without awaiting
          resultsPromises.push(handle.insertOrigin(candidate.hash));
          break;
        case 'exempt':
          ctx.logger.info(
            `Exempted image found for image #${candidate.index}, with hash ${hashToBinaryString(candidate.hash)}.`,
          );
          break;
        case 'found':
          ctx.logger.info(
            `Similar image found for image #${candidate.index}, with hash ${hashToBinaryString(candidate.hash)}.`,
          );
          // Point this out later. To do this, we must:
          //  query from database the origin, and
          //  record user information.
          resultsPromises.push(
            handle
              .addRecordAndQueryOrigin(candidate.key)
              .then((origin) => ({ index: candidate.index, ...origin })),
          );
          // TODO: if there are tortures, we should give user a chance to exempt.
          break;
      }
    }

    const tortures = (await Promise.all(resultsPromises)).filter(
      (result): result is Torture => result !== undefined,
    );
    if (tortures.length === 0) {
      return;
    }
    const torturesData = await Promise.all(
      tortures.map(async (torture) => {
        const nickname = await getNickname(session, torture.senderId);
        const date = new Date(torture.timestamp);
        return { index: torture.index, date, nickname };
      }),
    );
    const tortureText = torturesData
      .map(
        ({ index, date, nickname }) =>
          `第 ${index} 张图片在 ${date.toLocaleString()} 由 ${nickname} 水过了`,
      )
      .join('\n');
    await session.send([
      h.quote(session.messageId),
      h.text(`水过啦！\n${tortureText}`),
    ]);
  });
}
