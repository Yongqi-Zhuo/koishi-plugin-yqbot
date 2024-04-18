import assert from 'assert';
import { Random } from 'koishi';

import { ChatTemplateKind, kindFor } from './common';
import { ChatTemplate } from './schema';

export class State {
  readonly eq: Map<string, number[]>;
  readonly cn: Map<string, number[]>;

  constructor(eq?: Map<string, number[]>, cn?: Map<string, number[]>) {
    this.eq = eq || new Map();
    this.cn = cn || new Map();
  }

  private getOrSetDefault(kind: ChatTemplateKind, question: string): number[] {
    const map = this[kind];
    if (!map.has(question)) {
      map.set(question, []);
    }
    return map.get(question)!;
  }

  private getOrReturnDefault(
    kind: ChatTemplateKind,
    question: string,
  ): number[] {
    const map = this[kind];
    return map.get(question) || [];
  }

  // Used for building the state.
  accumulate({ id, inexact, question }: ChatTemplate) {
    this.getOrSetDefault(kindFor(inexact), question).push(id);
  }

  answer(question: string): number | null {
    const ids = this.getOrReturnDefault('eq', question);
    // If there is no exact match, try to find a match in cn.
    if (ids.length === 0) {
      for (const [q, qIds] of this.cn) {
        if (question.includes(q)) {
          ids.push(...qIds);
        }
      }
      if (ids.length === 0) return null;
    }
    const id = Random.pick(ids);
    return id;
  }

  remember(kind: ChatTemplateKind, question: string, id: number) {
    this.getOrSetDefault(kind, question).push(id);
  }

  lookup(kind: ChatTemplateKind, question: string) {
    // Do not store [] if the question is not found.
    return this.getOrReturnDefault(kind, question);
  }

  remove(kind: ChatTemplateKind, question: string, id: number) {
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
