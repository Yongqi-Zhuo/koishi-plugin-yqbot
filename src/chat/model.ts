import assert from 'assert';
import { Context } from 'koishi';

import { createChannelwiseStorage } from '../common';
import { ChatTemplateKind, kindFor } from './common';
import { ChatTemplate } from './schema';

export class State {
  readonly eq: Map<string, number[]>;
  readonly cn: Map<string, number[]>;
  constructor(eq?: Map<string, number[]>, cn?: Map<string, number[]>) {
    this.eq = eq || new Map();
    this.cn = cn || new Map();
  }
  getOrDefault(kind: ChatTemplateKind, question: string): number[] {
    const map = this[kind];
    if (!map.has(question)) {
      map.set(question, []);
    }
    return map.get(question)!;
  }
  get(kind: ChatTemplateKind, question: string): number[] | undefined {
    const map = this[kind];
    return map.get(question);
  }
  removeFrom(kind: ChatTemplateKind, question: string, id: number) {
    const map = this[kind];
    const ids = map.get(question);
    assert(ids, 'removeFrom: question not found');
    const index = ids.indexOf(id);
    assert(index >= 0, 'removeFrom: id not found');
    if (ids.length === 1) {
      map.delete(question);
    } else {
      ids.splice(index, 1);
    }
  }
  list(kind: ChatTemplateKind): string[] {
    return Array.from(this[kind].keys());
  }
}

export const initializeStates = (ctx: Context) => {
  return createChannelwiseStorage(
    ctx,
    'chat',
    State,
    (state: State, { id, inexact, question }: ChatTemplate): undefined => {
      state.getOrDefault(kindFor(inexact), question).push(id);
    },
  );
};
