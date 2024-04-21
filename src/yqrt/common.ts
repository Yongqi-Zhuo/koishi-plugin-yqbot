import os from 'os';
import temp from 'temp';

temp.track();

const tempDirPrefix = 'yqbot-yqrt-';
export const makeTempDir = () =>
  temp.mkdir({
    prefix: tempDirPrefix,
    dir: os.tmpdir(),
  });

export const CFamilyLanguages = ['c', 'c++'] as const;
export const PythonLanguage = 'python' as const;

export const Languages = [...CFamilyLanguages, PythonLanguage] as const;

export const SourceFileExtensions = {
  c: '.c',
  'c++': '.cpp',
  python: '.py',
} as const;
