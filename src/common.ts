import assert from 'assert';
import koishi, { Context, Session } from 'koishi';

export const getChannelKey = (session: Session) => {
  const { platform, selfId, guildId, channelId } = session;
  return `${platform}.${selfId}.${guildId}.${channelId}`;
};

export const getNickname = async (session: Session, userId: string) => {
  try {
    const member = await session.bot.getGuildMember(session.guildId, userId);
    const nick = member.nick;
    if (nick) return nick;
    return member.user!.name!;
  } catch (e) {
    // If this is not a guild member, we have to get the user.
  }
  try {
    const user = await session.bot.getUser(userId);
    return user.nick || user.name || userId;
  } catch (e) {
    return userId;
  }
};

type Tables = koishi.Tables;

export interface ChannelwiseSchema {
  channelKey: string;
}

type ChannelwiseTableNames = {
  [Table in keyof Tables]: Tables[Table] extends ChannelwiseSchema
    ? Table
    : never;
}[keyof Tables];

// The storage keeps a state for each channel.
class ChannelwiseStorage<State> {
  constructor(
    readonly ctx: Context,
    readonly storage: Map<string, State>,
    readonly StateConstructor: () => State,
  ) {}

  getState(key: string): State {
    if (!this.storage.has(key)) {
      this.storage.set(key, this.StateConstructor());
    }
    return this.storage.get(key)!;
  }
}

function functionalizeConstructor<S, T extends (new () => S) | (() => S)>(
  ctor: T,
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

async function createChannelwiseStorageComplex<
  State,
  TableName extends ChannelwiseTableNames,
  Medium,
  ReducerRet extends Medium | undefined,
>(
  ctx: Context,
  table: TableName,
  StateConstructor: () => State,
  reducer: (state: Medium, row: Tables[TableName]) => ReducerRet,
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
    if (ret !== undefined) {
      media.set(key, ret);
    }
  }
  // Convert the data to states.
  const states = new Map(Array.from(media, ([k, v]) => [k, epilogue(v)]));
  return new ChannelwiseStorage<State>(ctx, states, StateConstructor);
}

async function createChannelwiseStorageSimple<
  State,
  TableName extends ChannelwiseTableNames,
  ReducerRet extends State | undefined,
>(
  ctx: Context,
  table: TableName,
  StateConstructor: () => State,
  reducer: (state: State, row: Tables[TableName]) => ReducerRet,
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
    if (ret !== undefined) {
      states.set(key, ret);
    }
  }
  return new ChannelwiseStorage<State>(ctx, states, StateConstructor);
}

// With this function, you can first perform a reduction on the data, and then convert the data to states.
export function createChannelwiseStorage<
  State,
  TableName extends ChannelwiseTableNames,
  Medium,
  ReducerRet extends Medium | undefined,
>(
  ctx: Context,
  table: TableName,
  // Pass a class name or a factory function.
  StateConstructor: (new () => State) | (() => State),
  // Reduce the data to the intermediate state. If the return value is not undefined, it will be used as the new intermediate state.
  reducer: (state: Medium, row: Tables[TableName]) => ReducerRet,
  // Initial intermediate state.
  prologue: () => Medium,
  // Convert the intermediate state to the final state.
  epilogue: (state: Medium) => State,
): Promise<ChannelwiseStorage<State>>;

// With this function, you can directly convert the data to states.
export function createChannelwiseStorage<
  State,
  TableName extends ChannelwiseTableNames,
  ReducerRet extends State | undefined,
>(
  ctx: Context,
  table: TableName,
  // Pass a class name or a factory function.
  StateConstructor: (new () => State) | (() => State),
  // Reduce the data to the state. If the return value is not undefined, it will be used as the new state.
  reducer: (state: State, row: Tables[TableName]) => ReducerRet,
): Promise<ChannelwiseStorage<State>>;

export async function createChannelwiseStorage<
  State,
  TableName extends ChannelwiseTableNames,
>(
  ctx: Context,
  table: TableName,
  StateConstructor: (new () => State) | (() => State),
  reducer: (state: any, row: Tables[TableName]) => any,
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
    return createChannelwiseStorageSimple(
      ctx,
      table,
      StateConstructor,
      reducer,
    );
  }
  throw new Error('prologue and epilogue must be both defined or undefined.');
}
