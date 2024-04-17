import { Context, Random, Session } from 'koishi';

import { ChatTemplateKind, inexactFor, kindFor } from './common';
import { State } from './model';

export type BatchedRemovalResult = { success: number[]; failure: number[] };

export class Controller {
  constructor(
    private readonly channelKey: string,
    private readonly ctx: Context,
    readonly state: State,
  ) {}

  async answer(question: string): Promise<string | null> {
    const ids = this.state.get('eq', question) || [];
    // If there is no exact match, try to find a match in cn.
    if (ids.length === 0) {
      for (const [q, qIds] of this.state.cn) {
        if (question.includes(q)) {
          ids.push(...qIds);
        }
      }
      if (ids.length === 0) return null;
    }
    const id = Random.pick(ids);
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
    this.state.getOrDefault(kind, question).push(id);
  }

  async lookup(kind: ChatTemplateKind, question: string) {
    const ids = this.state.get(kind, question);
    if (!ids) return [];
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
    this.state.removeFrom(kind, question, result.id);
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
      this.state.removeFrom(kindFor(inexact), question, id);
      rest.delete(id);
    }
    return {
      success: recordsIds,
      failure: Array.from(rest),
    };
  }
}
