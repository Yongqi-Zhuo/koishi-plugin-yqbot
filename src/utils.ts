// https://dev.to/chrismilson/zip-iterator-in-typescript-ldm
type Iterableify<T> = { [K in keyof T]: Iterable<T[K]> };
export function* zip<T extends Array<any>>(
  ...toZip: Iterableify<T>
): Generator<T> {
  // Get iterators for all of the iterables.
  const iterators = toZip.map((i) => i[Symbol.iterator]());
  while (true) {
    // Advance all of the iterators.
    const results = iterators.map((i) => i.next());
    // If any of the iterators are done, we should stop.
    if (results.some(({ done }) => done)) {
      break;
    }
    // We can assert the yield type, since we know none
    // of the iterators are done.
    yield results.map(({ value }) => value) as T;
  }
}

export function functionalizeConstructor<S>(
  ctor: (new () => S) | (() => S),
): () => S {
  'use strict';
  try {
    // If `ctor` is a constructor, we must use `new`. So this will throw an error.
    const res = (ctor as () => S)();
    if (res === undefined) {
      // Maybe this is a constructor.
      return () => new (ctor as new () => S)();
    }
    return ctor as () => S;
  } catch (e) {
    if (e instanceof TypeError) {
      return () => new (ctor as new () => S)();
    } else {
      // This is not a TypeError. We should rethrow it.
      throw e;
    }
  }
}
