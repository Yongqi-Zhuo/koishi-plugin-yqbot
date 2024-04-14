import os from 'os';
import temp from 'temp';

temp.track();

const tempDirPrefix = 'yqbot-yqrt-';
export const makeTempDir = () =>
  temp.mkdir({
    prefix: tempDirPrefix,
    dir: os.tmpdir(),
  });
