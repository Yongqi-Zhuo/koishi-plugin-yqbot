import {} from '@koishijs/assets';
import { Context, Random, Schema, Session, h } from 'koishi';
import _ from 'underscore';

import { getChannelKey } from '../common';
import { ChannelState, ChatTemplateKind, inexactFor, kindFor } from './common';
import { declareSchema } from './database';
import { DatabaseHandle, initializeStates } from './model';

export const name = 'chat';

export const inject = ['assets'];

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
  const getHandle = (session: Session) => {
    const key = getChannelKey(session);
    if (!sessionsStates.has(key)) {
      sessionsStates.set(key, new ChannelState());
    }
    return new DatabaseHandle(key, ctx, sessionsStates.get(key)!);
  };

  ctx.middleware(async (session, next) => {
    if (!_.all(session.elements, (e) => e.type === 'text')) {
      // Not all elements are text.
      return next();
    }
    const question = session.content;
    const handle = getHandle(session);
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
    .command('chat.remember <question:string> <answer:text>')
    .option('inexact', '-i')
    .action(async ({ session, options }, question: string, answer: string) => {
      console.log('chat.remember', question, answer);
      if (typeof question !== 'string' || typeof answer !== 'string') {
        return h.text('参数错误。');
      }
      const handle = getHandle(session);
      const savedAnswer = await ctx.assets.transform(answer);
      const kind = kindFor(options.inexact);
      await handle.remember(kind, question, savedAnswer, session);
      return h.text('已记住这一回复。');
    });

  ctx
    .command('chat.lookup <question:string>')
    .option('inexact', '-i')
    .action(async ({ session, options }, question: string) => {
      if (typeof question !== 'string') {
        return h.text('参数错误。');
      }
      const handle = getHandle(session);
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
    .command('chat.forget <question:string> <answer:text>')
    .option('inexact', '-i')
    .action(async ({ session, options }, question: string, answer: string) => {
      if (typeof question !== 'string' || typeof answer !== 'string') {
        return h.text('参数错误。');
      }
      const handle = getHandle(session);
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
      const handle = getHandle(session);
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
      const handle = getHandle(session);
      const kind = kindFor(options.inexact);
      const questions = handle.state.list(kind);
      if (questions.length === 0) {
        return h.text('没有保存的回复。');
      }
      return h.text(`${questions.join('\n')}`);
    });
}
