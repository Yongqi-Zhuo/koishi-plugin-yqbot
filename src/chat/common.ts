// eq: the question be identical to the message.
// cn: the message contains the question.
export type ChatTemplateKind = 'eq' | 'cn';
export const kindFor = (inexact?: boolean): ChatTemplateKind =>
  inexact ? 'cn' : 'eq';
export const inexactFor = (kind: ChatTemplateKind): boolean => kind === 'cn';
