import { Context, Session, Tables } from 'koishi';

import { getChannelKey } from './common';
import { functionalizeConstructor } from './utils';

export type ChannelwiseSchema = {
  channelKey: string;
};

const getKey = (keyOrSession: string | Session): string =>
  typeof keyOrSession === 'string' ? keyOrSession : getChannelKey(keyOrSession);

type ControllerConstructor<State, Controller> = new (
  ctx: Context,
  channelKey: string,
  state: State,
) => Controller;

// The storage keeps a state for each channel.
class ChannelwiseStorage<State> {
  constructor(
    readonly storage: Map<string, State>,
    readonly StateConstructor: () => State,
  ) {}

  getState(keyOrSession: string | Session): State {
    const key = getKey(keyOrSession);
    if (!this.storage.has(key)) {
      this.storage.set(key, this.StateConstructor());
    }
    return this.storage.get(key)!;
  }

  withController<Controller>(
    ctx: Context,
    ControllerConstructor: ControllerConstructor<State, Controller>,
  ): ChannelwiseStorageWithController<State, Controller> {
    return new ChannelwiseStorageWithController(
      ctx,
      this.storage,
      this.StateConstructor,
      ControllerConstructor,
    );
  }
}

// With this class, you can get the controller for each channel.
class ChannelwiseStorageWithController<
  State,
  Controller,
> extends ChannelwiseStorage<State> {
  constructor(
    readonly ctx: Context,
    storage: Map<string, State>,
    StateConstructor: () => State,
    readonly ControllerConstructor: ControllerConstructor<State, Controller>,
  ) {
    super(storage, StateConstructor);
  }

  getController(keyOrSession: string | Session): Controller {
    const key = getKey(keyOrSession);
    return new this.ControllerConstructor(this.ctx, key, this.getState(key));
  }
}

type StateReducer<State, Row> = (state: State, row: Row) => State | undefined;
type AccumulativeState<Row> = { accumulate: (row: Row) => void };

function createChannelwiseStorageComplex<
  Schema extends ChannelwiseSchema,
  State,
  Medium,
>(
  data: Iterable<Schema>,
  StateConstructor: () => State,
  reducer: StateReducer<Medium, Schema>,
  prologue: () => Medium,
  epilogue: (state: Medium) => State,
): ChannelwiseStorage<State> {
  const media = new Map<string, Medium>();
  // Aggregate the data.
  for (const row of data) {
    const key = row.channelKey;
    if (!media.has(key)) {
      media.set(key, prologue());
    }
    const medium = media.get(key)!;
    // Add the row.
    const ret = reducer(medium, row);
    // Only upon update, we update the medium.
    if (ret !== undefined && ret !== medium) {
      media.set(key, ret);
    }
  }
  // Convert the data to states.
  const states = new Map(Array.from(media, ([k, v]) => [k, epilogue(v)]));
  return new ChannelwiseStorage(states, StateConstructor);
}

function createChannelwiseStorageSimple<
  Schema extends ChannelwiseSchema,
  State,
>(
  data: Iterable<Schema>,
  StateConstructor: () => State,
  reducer: StateReducer<State, Schema>,
): ChannelwiseStorage<State> {
  const states = new Map<string, State>();
  // Aggregate the data.
  for (const row of data) {
    const key = row.channelKey;
    if (!states.has(key)) {
      states.set(key, StateConstructor());
    }
    const state = states.get(key)!;
    // Add the row.
    const ret = reducer(state, row);
    // Only upon update, we update the state.
    if (ret !== undefined && ret !== state) {
      states.set(key, ret);
    }
  }
  return new ChannelwiseStorage(states, StateConstructor);
}

// With this function, you can first perform a reduction on the data, and then convert the data to states.
export function createChannelwiseStorage<
  Schema extends ChannelwiseSchema,
  State,
  Medium,
>(
  data: Iterable<Schema>,
  // Pass a class name or a factory function.
  StateConstructor: (new () => State) | (() => State),
  // Reduce the data to the intermediate state. If the return value is not undefined, it will be used as the new intermediate state.
  reducer: StateReducer<Medium, Schema>,
  // Initial intermediate state.
  prologue: () => Medium,
  // Convert the intermediate state to the final state.
  epilogue: (state: Medium) => State,
): ChannelwiseStorage<State>;

// With this function, you can directly convert the data to states.
export function createChannelwiseStorage<
  Schema extends ChannelwiseSchema,
  State,
>(
  data: Iterable<Schema>,
  // Pass a class name or a factory function.
  StateConstructor: (new () => State) | (() => State),
  // Reduce the data to the state. If the return value is not undefined, it will be used as the new state. If the state is accumulative, a default reducer is provided, which is the below overload.
  reducer: StateReducer<State, Schema>,
): ChannelwiseStorage<State>;

// Same as above. But the reducer is optional.
export function createChannelwiseStorage<
  Schema extends ChannelwiseSchema,
  State extends AccumulativeState<Schema>,
>(
  data: Iterable<Schema>,
  StateConstructor: (new () => State) | (() => State),
  reducer?: StateReducer<State, Schema>,
): ChannelwiseStorage<State>;

export function createChannelwiseStorage<
  Schema extends ChannelwiseSchema,
  State,
>(
  data: Iterable<Schema>,
  StateConstructor: (new () => State) | (() => State),
  reducer?: StateReducer<any, Schema>,
  prologue?: () => any,
  epilogue?: (state: any) => State,
): ChannelwiseStorage<State> {
  StateConstructor = functionalizeConstructor(StateConstructor);
  if (prologue !== undefined && epilogue !== undefined) {
    return createChannelwiseStorageComplex(
      data,
      StateConstructor,
      reducer,
      prologue,
      epilogue,
    );
  } else if (prologue === undefined && epilogue === undefined) {
    if (reducer === undefined) {
      // Default reducer.
      reducer = (state: AccumulativeState<Schema>, row: Schema): undefined => {
        state.accumulate(row);
      };
    }
    return createChannelwiseStorageSimple(data, StateConstructor, reducer);
  }
  throw new Error('prologue and epilogue must be both defined or undefined.');
}
