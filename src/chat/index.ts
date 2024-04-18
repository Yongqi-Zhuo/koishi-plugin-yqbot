import {} from '@koishijs/assets';
import { Context, Schema, Session, h } from 'koishi';
import _ from 'underscore';

import { getChannelKey } from '../common';
import { kindFor } from './common';
import { Controller, initializeStates } from './controller';
import { declareSchema } from './schema';

export const name = 'chat';

export const inject = ['assets', 'database'];

export interface Config {
  enabled: boolean;
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('Global switch for auto chat.'),
});

export async function apply(ctx: Context, config: Config) {
  declareSchema(ctx);

  if (!config.enabled) return;

  const sessionsStates = await initializeStates(ctx);
  const getController = (session: Session) =>
    sessionsStates.getController(session);

  ctx.middleware(async (session, next) => {
    if (!_.all(session.elements, (e) => e.type === 'text')) {
      // Not all elements are text.
      return next();
    }
    const question = session.content;
    const handle = getController(session);
    const answer = await handle.answer(question);
    if (!answer) {
      // No answer found.
      return next();
    }
    // Do not escape. Because we need to send rich text.
    return answer;
  });

  ctx.command('chat', '自动回复');

  ctx
    .command('chat.remember <question:string> [answer:text]', {
      checkUnknown: true,
      checkArgCount: true,
    })
    .option('inexact', '-i')
    .action(async ({ session, options }, question: string, answer?: string) => {
      if (!answer) {
        await session.send('请提供一个回复。直接输入就行了。');
        // This is the next message.
        answer = await session.prompt();
      }
      if (typeof answer !== 'string') {
        return h.text('这次没有 remember 成功，下次再试吧。');
      }
      // The OneBot adapter sucks at <face /> elements, where it automatically inserts a child <image /> element. We should remove it.
      answer = h.transform(answer, {
        face: (attrs) => {
          // Jump out if the platform is not OneBot.
          if (attrs.platform !== 'onebot') return false;
          // Now we are sure that the platform is OneBot.
          // Do not return the children inside.
          return h('face', attrs);
        },
      });
      const handle = getController(session);
      const savedAnswer = await ctx.assets.transform(answer);
      const kind = kindFor(options.inexact);
      await handle.remember(kind, question, savedAnswer, session);
      return h.text('已记住这一回复。');
    });

  ctx
    .command('chat.lookup <question:string>', {
      checkUnknown: true,
      checkArgCount: true,
    })
    .option('inexact', '-i')
    .action(async ({ session, options }, question: string) => {
      const handle = getController(session);
      const kind = kindFor(options.inexact);
      const records = await handle.lookup(kind, question);
      if (records.length === 0) {
        return h.text('没有找到这个问题。');
      }
      return h.text(
        records.map(({ id, answer }) => `#${id}: ${answer}`).join('\n'),
      );
    });

  ctx
    .command('chat.forget <question:string> <answer:text>', {
      checkUnknown: true,
      checkArgCount: true,
    })
    .option('inexact', '-i')
    .action(async ({ session, options }, question: string, answer: string) => {
      const handle = getController(session);
      // No need to save the answer.
      const kind = kindFor(options.inexact);
      const success = await handle.forget(kind, question, answer);
      if (!success) {
        return h.text('没有找到这个回复。');
      }
      return h.text('已忘记这个回复。');
    });

  ctx
    .command('chat.remove [...ids:number]')
    .action(async ({ session }, ...ids: number[]) => {
      if (!ids || ids.length === 0) {
        return h.text('只需要提供要删除的回复的序号。');
      }
      const handle = getController(session);
      const { success, failure } = await handle.remove(ids);
      if (failure.length === 0) {
        return h.text(`已删除这${success.length > 1 ? '些' : '个'}回复。`);
      }
      return h.text(
        `序号为 ${failure.join(', ')} 的回复不存在，所以没有删除。` +
          (success.length > 0 ? '其他的回复已成功删除。' : ''),
      );
    });

  ctx
    .command('chat.list')
    .option('inexact', '-i')
    .action(async ({ session, options }) => {
      const handle = getController(session);
      const kind = kindFor(options.inexact);
      const questions = handle.list(kind);
      if (questions.length === 0) {
        return h.text('没有保存的回复。');
      }
      return h.text(`${questions.join('\n')}`);
    });
}
