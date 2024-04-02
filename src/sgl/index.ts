import { Context, Schema, h } from 'koishi';
import {} from 'koishi-plugin-adapter-onebot';
import { zip } from '../utils';
import HashIndex, { QueryResult, QueryResultFound } from './HashIndex';
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

type Candidate = { index: number } & QueryResult;
type FoundCandidate = { index: number } & QueryResultFound;

export function apply(ctx: Context, config: Config) {
  // Find HashIndex for each channel.
  const sessionState: Map<string, HashIndex> = new Map();

  // TODO: read from database
  let db = 0;

  ctx.on('message', async (session) => {
    const nick = session.event.member?.nick; // bad if undefined or ''
    const call = !nick ? session.event.user!.name! : nick;

    // We need to find the HashIndex.
    const stateKey = `${session.guildId}.${session.channelId}`;
    if (!sessionState.has(stateKey)) {
      sessionState.set(
        stateKey,
        new HashIndex(config.tolerance, new Map(), new Set()),
      );
    }
    const state = sessionState.get(stateKey)!;

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
          const queryResult = state.query(hash);
          return { index, ...queryResult };
        })(),
      );
    }

    // Now all the downloads and the queries are in progress.
    // Wait for them to finish.
    const candidates = (await Promise.all(candidatesPromises)).filter(
      (candidate): candidate is Candidate => candidate !== null,
    );
    const results: FoundCandidate[] = [];
    for (const candidate of candidates) {
      switch (candidate.kind) {
        case 'none':
          ctx.logger.info(
            `No similar image found for image #${candidate.index}, with hash ${hashToBinaryString(candidate.hash)}.`,
          );
          // TODO: insert into database
          const key = db++;
          state.insert({ key, hash: candidate.hash });
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
          // Point this out.
          results.push(candidate);
          // TODO: query from database the information.
          // TODO: record user information.
          break;
      }
    }

    if (results.length === 0) {
      return;
    }
    await session.send([
      h.quote(session.messageId),
      h.text(
        `水过啦 ${call}！第 ${results.map((result) => result.index).join(', ')} 张图片已经水过了。`,
      ),
    ]);
  });
}
