import Docker from 'dockerode';
import { Context } from 'koishi';

import { createChannelwiseStorage } from '../../channelwise';
import { ExecutionOptions } from './common';
import { getAllContainers } from './container';
import { State } from './model';

export const initializeStates = async (
  ctx: Context,
  docker: Docker,
  compileOptions: ExecutionOptions,
  runOptions: ExecutionOptions,
) => {
  const containers = await getAllContainers(docker);
  const dockerOptions = {
    docker,
    compileOptions,
    runOptions,
  };
  return createChannelwiseStorage(containers, () => new State(dockerOptions));
};
