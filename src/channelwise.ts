import { Context, Session, Tables } from 'koishi';

import { getChannelKey } from './common';
import { functionalizeConstructor } from './utils';

export interface ChannelwiseSchema {
  channelKey: string;
}

type ChannelwiseTableNames = {
  [Table in keyof Tables]: Tables[Table] extends ChannelwiseSchema
    ? Table
    : never;
}[keyof Tables];

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
    readonly ctx: Context,
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
    ControllerConstructor: ControllerConstructor<State, Controller>,
  ): ChannelwiseStorageWithController<State, Controller> {
    return new ChannelwiseStorageWithController(
      this.ctx,
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
    ctx: Context,
    storage: Map<string, State>,
    StateConstructor: () => State,
    readonly ControllerConstructor: ControllerConstructor<State, Controller>,
  ) {
    super(ctx, storage, StateConstructor);
  }

  getController(keyOrSession: string | Session): Controller {
    const key = getKey(keyOrSession);
    return new this.ControllerConstructor(this.ctx, key, this.getState(key));
  }
}

type StateReducer<State, Row> = (state: State, row: Row) => State | undefined;
type AccumulativeState<Row> = { accumulate: (row: Row) => void };

async function createChannelwiseStorageComplex<
  TableName extends ChannelwiseTableNames,
  State,
  Medium,
>(
  ctx: Context,
  table: TableName,
  StateConstructor: () => State,
  reducer: StateReducer<Medium, Tables[TableName]>,
  prologue: () => Medium,
  epilogue: (state: Medium) => State,
): Promise<ChannelwiseStorage<State>> {
  const media = new Map<string, Medium>();
  type Row = Tables[TableName];
  // It seems the typing system of koishi is not perfect.
  const data = (await ctx.database.select(table).execute()) as Row[];
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
  return new ChannelwiseStorage(ctx, states, StateConstructor);
}

async function createChannelwiseStorageSimple<
  TableName extends ChannelwiseTableNames,
  State,
>(
  ctx: Context,
  table: TableName,
  StateConstructor: () => State,
  reducer: StateReducer<State, Tables[TableName]>,
): Promise<ChannelwiseStorage<State>> {
  const states = new Map<string, State>();
  type Row = Tables[TableName];
  // It seems the typing system of koishi is not perfect.
  const data = (await ctx.database.select(table).execute()) as Row[];
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
  return new ChannelwiseStorage(ctx, states, StateConstructor);
}

// With this function, you can first perform a reduction on the data, and then convert the data to states.
export function createChannelwiseStorage<
  TableName extends ChannelwiseTableNames,
  State,
  Medium,
>(
  ctx: Context,
  table: TableName,
  // Pass a class name or a factory function.
  StateConstructor: (new () => State) | (() => State),
  // Reduce the data to the intermediate state. If the return value is not undefined, it will be used as the new intermediate state.
  reducer: StateReducer<Medium, Tables[TableName]>,
  // Initial intermediate state.
  prologue: () => Medium,
  // Convert the intermediate state to the final state.
  epilogue: (state: Medium) => State,
): Promise<ChannelwiseStorage<State>>;

// With this function, you can directly convert the data to states.
export function createChannelwiseStorage<
  TableName extends ChannelwiseTableNames,
  State,
>(
  ctx: Context,
  table: TableName,
  // Pass a class name or a factory function.
  StateConstructor: (new () => State) | (() => State),
  // Reduce the data to the state. If the return value is not undefined, it will be used as the new state. If the state is accumulative, a default reducer is provided, which is the below overload.
  reducer: StateReducer<State, Tables[TableName]>,
): Promise<ChannelwiseStorage<State>>;

// Same as above. But the reducer is optional.
export function createChannelwiseStorage<
  TableName extends ChannelwiseTableNames,
  State extends AccumulativeState<Tables[TableName]>,
>(
  ctx: Context,
  table: TableName,
  StateConstructor: (new () => State) | (() => State),
  reducer?: StateReducer<State, Tables[TableName]>,
): Promise<ChannelwiseStorage<State>>;

export async function createChannelwiseStorage<
  TableName extends ChannelwiseTableNames,
  State,
>(
  ctx: Context,
  table: TableName,
  StateConstructor: (new () => State) | (() => State),
  reducer?: StateReducer<any, Tables[TableName]>,
  prologue?: () => any,
  epilogue?: (state: any) => State,
): Promise<ChannelwiseStorage<State>> {
  StateConstructor = functionalizeConstructor(StateConstructor);
  if (prologue !== undefined && epilogue !== undefined) {
    return createChannelwiseStorageComplex(
      ctx,
      table,
      StateConstructor,
      reducer,
      prologue,
      epilogue,
    );
  } else if (prologue === undefined && epilogue === undefined) {
    if (reducer === undefined) {
      // Default reducer.
      reducer = (
        state: AccumulativeState<Tables[TableName]>,
        row: Tables[TableName],
      ): undefined => {
        state.accumulate(row);
      };
    }
    return createChannelwiseStorageSimple(
      ctx,
      table,
      StateConstructor,
      reducer,
    );
  }
  throw new Error('prologue and epilogue must be both defined or undefined.');
}
