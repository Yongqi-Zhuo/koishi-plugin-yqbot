import assert from 'assert';
import TimeAgo from 'javascript-time-ago';
import zh from 'javascript-time-ago/locale/zh';
import { Context, Schema, Session, h } from 'koishi';
import {} from 'koishi-plugin-adapter-onebot';

import { hashToBinaryString } from './common';
import {
  DatabaseHandle,
  SglOrigin,
  declareSchema,
  initializeStates,
} from './database';
import download from './download';
import HashIndex, { QueryResult } from './HashIndex';
import phash from './phash';
import { getChannelKey } from '../common';
import { zip } from '../utils';

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
  replyElement: any;
}

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

type Torture = { index: number } & SglOrigin;

TimeAgo.addDefaultLocale(zh);
const timeAgo = new TimeAgo('zh-CN');

export async function apply(ctx: Context, config: Config) {
  declareSchema(ctx);
  // HashIndex for each channel.
  const sessionsStates = await initializeStates(ctx, config.tolerance);
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
    return new DatabaseHandle(key, ctx, session, state);
  };

  ctx.on('message', async (session) => {
    // We need to find the HashIndex.
    const handle = getHandle(session);

    const fullRawElements = (session.onebot as any)?.raw?.elements as
      | RawElement[]
      | undefined;
    if (!fullRawElements) {
      ctx.logger.error('Enable debug mode to use this plugin.');
      return;
    }
    const elements = session.elements;
    const rawElements = fullRawElements.filter((e) => !e.replyElement);
    // OK. Now we are sure debug mode is on. We can distinguish between images and custom faces.

    let counter = 0;
    const candidatesPromises: Promise<Candidate | null>[] = [];
    if (rawElements.length !== elements.length) {
      ctx.logger.error('Length mismatch between rawElements and elements.');
      ctx.logger.error('   elements:', elements.length, ':', elements);
      ctx.logger.error('rawElements:', rawElements.length, ':', rawElements);
      return;
    }
    for (const [rawElement, e] of zip(rawElements, elements)) {
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
        ctx.logger.debug('This IS a custom face:', e);
        // It is usual to send the same custom face multiple times.
        // Do not count them.
        continue;
      } else {
        ctx.logger.debug('This is NOT a custom face:', e);
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
          // Insert into database without awaiting.
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
          // TODO: anti recall.
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
    const single = ({ date, nickname }: { date: Date; nickname: string }) =>
      `在${timeAgo.format(date)}（${
        // YYYY年MM月DD日HH时MM分SS秒
        date.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      }）由 ${nickname}`;
    let tortureText: string;
    let tortureEpilogue: string;
    if (counter === 1) {
      assert(torturesData.length === 1);
      tortureText = `这张图片${single(torturesData[0])} 水过了。`;
      tortureEpilogue = '请发送 /sgl ignore 来忽略。';
    } else {
      tortureText = `这些图片中的：\n${torturesData
        .map(
          ({ index, date, nickname }) =>
            `  第 ${index} 张图片${single({ date, nickname })}`,
        )
        .join('；\n')}\n水过了。`;
      tortureEpilogue = '请发送 /sgl ignore <要忽略的图片序号> 来忽略。';
    }
    await session.send([
      h.quote(session.messageId),
      h.text(`水过啦！${tortureText}\n如果这是一张表情包，${tortureEpilogue}`),
    ]);
  });
}
