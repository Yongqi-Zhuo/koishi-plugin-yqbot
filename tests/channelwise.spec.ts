import memory from '@koishijs/plugin-database-memory';
import mock from '@koishijs/plugin-mock';
import { expect } from 'chai';
import { Context } from 'koishi';

import { createChannelwiseStorage } from '../src/channelwise';

interface TestSchema {
  id: number;
  channelKey: string;
  name: string;
}

declare module 'koishi' {
  interface Tables {
    test: TestSchema;
  }
}

const declareSchema = (ctx: Context) => {
  ctx.model.extend(
    'test',
    {
      id: 'unsigned',
      channelKey: 'string',
      name: 'string',
    },
    {
      primary: 'id',
      autoInc: true,
    },
  );
};

const app = new Context();
app.plugin(mock);
app.plugin(memory);

const user0 = 'user0';
const channel0 = 'channel0';
const channel1 = 'channel1';

before(async () => {
  await app.start();

  await app.mock.initUser(user0);
  await app.mock.initChannel(channel0);
  await app.mock.initChannel(channel1);

  declareSchema(app);

  await app.database.create('test', { channelKey: channel0, name: 'good0' });
  await app.database.create('test', { channelKey: channel0, name: 'good1' });
  await app.database.create('test', { channelKey: channel1, name: 'bad0' });
});

after(() => app.stop());

describe('channelwise', async () => {
  it('should count correctly', async () => {
    const countStorage = await createChannelwiseStorage(
      app,
      'test',
      () => 0,
      (state: number) => state + 1,
    );
    expect(countStorage.getState(channel0)).to.equal(2);
    expect(countStorage.getState(channel1)).to.equal(1);
  });

  it('should aggregate correctly', async () => {
    const aggregateStorage = await createChannelwiseStorage(
      app,
      'test',
      Set<string>,
      (state: Set<string>, row: TestSchema) => state.add(row.name),
    );
    expect(aggregateStorage.getState(channel0)).to.deep.equal(
      new Set(['good0', 'good1']),
    );
    expect(aggregateStorage.getState(channel1)).to.deep.equal(
      new Set(['bad0']),
    );
  });
});
