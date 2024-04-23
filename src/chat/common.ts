import { h } from 'koishi';

// eq: the question be identical to the message.
// cn: the message contains the question.
export type ChatTemplateKind = 'eq' | 'cn';
export const kindFor = (inexact?: boolean): ChatTemplateKind =>
  inexact ? 'cn' : 'eq';
export const inexactFor = (kind: ChatTemplateKind): boolean => kind === 'cn';

// The OneBot adapter sucks at <face /> elements, where it automatically inserts a child <image /> element. We should remove it.
export const removeImagesInFaces = (content: string) => {
  return h.transform(content, {
    face: (attrs) => {
      // Jump out if the platform is not OneBot.
      if (attrs.platform !== 'onebot') return false;
      // Now we are sure that the platform is OneBot.
      // Do not return the children inside.
      return h('face', attrs);
    },
  });
};
