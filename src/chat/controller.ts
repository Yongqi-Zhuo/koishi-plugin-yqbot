import { Context, Session } from 'koishi';

import { createChannelwiseStorage } from '../channelwise';
import { ChatTemplateKind, inexactFor, kindFor } from './common';
import { State } from './model';

export type BatchedRemovalResult = { success: number[]; failure: number[] };

export class Controller {
  constructor(
    private readonly ctx: Context,
    private readonly channelKey: string,
    public readonly state: State,
  ) {}

  async answer(question: string): Promise<string | null> {
    const id = this.state.answer(question);
    if (id === null) return null;
    const [{ answer }] = await this.ctx.database.get('chat', id, ['answer']);
    return answer;
  }

  async remember(
    kind: ChatTemplateKind,
    question: string,
    answer: string,
    { userId, timestamp }: Session,
  ) {
    const { id } = await this.ctx.database.create('chat', {
      channelKey: this.channelKey,
      inexact: inexactFor(kind),
      question,
      answer,
      timestamp,
      author: userId,
    });
    this.state.remember(kind, question, id);
  }

  async lookup(kind: ChatTemplateKind, question: string) {
    const ids = this.state.lookup(kind, question);
    if (ids.length === 0) return [];
    return await this.ctx.database.get(
      'chat',
      {
        id: ids,
        inexact: inexactFor(kind),
      },
      ['id', 'answer'],
    );
  }

  async forget(
    kind: ChatTemplateKind,
    question: string,
    answer: string,
  ): Promise<boolean> {
    const [result] = await this.ctx.database.get('chat', {
      channelKey: this.channelKey,
      inexact: inexactFor(kind),
      question,
      answer,
    });
    if (!result) return false;
    await this.ctx.database.remove('chat', result.id);
    this.state.remove(kind, question, result.id);
    return true;
  }

  async remove(ids: number[]): Promise<BatchedRemovalResult> {
    const records = await this.ctx.database.get('chat', {
      id: ids,
      channelKey: this.channelKey,
    });
    const recordsIds = records.map((r) => r.id);
    await this.ctx.database.remove('chat', recordsIds);
    const rest = new Set(ids);
    for (const { inexact, question, id } of records) {
      this.state.remove(kindFor(inexact), question, id);
      rest.delete(id);
    }
    return {
      success: recordsIds,
      failure: Array.from(rest),
    };
  }

  list(kind: ChatTemplateKind): string[] {
    return this.state.list(kind);
  }
}

export const initializeStates = async (ctx: Context) => {
  const storage = createChannelwiseStorage(
    await ctx.database.select('chat').execute(),
    State,
  );
  return storage.withController(
    (channelKey, state) => new Controller(ctx, channelKey, state),
  );
};
