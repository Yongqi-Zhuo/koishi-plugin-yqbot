import assert from 'assert';
import TimeAgo from 'javascript-time-ago';
import zh from 'javascript-time-ago/locale/zh';
import { Context, Schema, Session, h } from 'koishi';
import {} from 'koishi-plugin-adapter-onebot';

import { hashToBinaryString } from './common';
import { DatabaseHandle, SglOrigin, declareSchema } from './database';
import download from './download';
import { QueryResult } from './HashIndex';
import {
  AntiRecallMeta,
  ChannelState,
  IgnoreError,
  initializeStates,
} from './model';
import phash from './phash';
import { getChannelKey, getNickname } from '../common';
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

type Candidate = { index: number; src: string; title: string } & QueryResult;

type Torture = { index: number } & SglOrigin;

TimeAgo.addLocale(zh);
const timeAgo = new TimeAgo('zh-CN');

export async function apply(ctx: Context, config: Config) {
  declareSchema(ctx);
  // HashIndex for each channel.
  const sessionsStates = await initializeStates(ctx, config.tolerance);
  const getState = (key: string) => {
    if (!sessionsStates.has(key)) {
      sessionsStates.set(key, ChannelState(config.tolerance));
    }
    return sessionsStates.get(key)!;
  };

  ctx.on('message', async (session) => {
    // We need to find the HashIndex.
    const channelKey = getChannelKey(session);
    const state = getState(channelKey);
    const handle = new DatabaseHandle(channelKey, ctx, session, state.index);

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
      const title = e.attrs.title;
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
          return { index, src: url, title, ...queryResult };
        })(),
      );
    }

    // Now all the downloads and the queries are in progress.
    // Wait for them to finish.
    const candidates = (await Promise.all(candidatesPromises)).filter(
      (candidate): candidate is Candidate => candidate !== null,
    );
    const resultsPromises: Promise<Torture | undefined>[] = [];
    const antiRecall: AntiRecallMeta = { userId: session.userId, images: [] };
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
          // Anti-recall.
          antiRecall.images.push({
            src: candidate.src,
            title: candidate.title,
          });
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
        return { index: torture.index, date, nickname, originId: torture.id };
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
    const messageId = session.messageId;
    await session.send([
      h.quote(messageId),
      h.text(`水过啦！${tortureText}\n如果这是一张表情包，${tortureEpilogue}`),
    ]);

    // If there are tortures, we should give user a chance to ignore.
    state.ignore.reset(
      torturesData.map(({ index, originId }) => [index, originId]),
    );

    // Anti-recall.
    state.antiRecall.set(messageId, antiRecall);
    ctx.setTimeout(() => state.antiRecall.delete(messageId), 1000 * 60 * 5); // 5 minutes
  });

  // Exempt.
  ctx
    .command(
      'sgl.ignore [index:posint]',
      '标记一张图片为表情包，使之不再被查重。',
    )
    .action(async ({ session }, index) => {
      const channelKey = getChannelKey(session);
      const state = getState(channelKey);
      try {
        const originId = state.ignore.pop(index);
        const handle = new DatabaseHandle(
          channelKey,
          ctx,
          session,
          state.index,
        );
        await handle.setExempt(originId);
        return '已忽略指定的图片。';
      } catch (e) {
        if (e instanceof IgnoreError) {
          return e.message;
        } else {
          throw e;
        }
      }
    });

  // Anti-recall.
  ctx.on('message-deleted', async (session) => {
    const channelKey = getChannelKey(session);
    const state = getState(channelKey);
    const messageId = session.messageId;
    if (!state.antiRecall.has(messageId)) {
      return;
    }
    const antiRecall = state.antiRecall.get(messageId)!;
    state.antiRecall.delete(messageId);

    const nickname = await getNickname(session, antiRecall.userId);
    await session.send([
      h.text(`${nickname} 被 yqbot 查重之后把消息撤回啦！以下是撤回的图片：`),
      ...antiRecall.images.map(({ src, title }) => h.image(src, { title })),
    ]);
  });
}
