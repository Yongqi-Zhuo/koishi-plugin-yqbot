import { UnprocessedExecResult, execute, sandbox } from './execute';

export type CompilerOptions = {
  maxOutput: number;
  timeoutCompile: number;
  timeoutRun: number;
};

export const CFamilyLanguages = ['c', 'c++'] as const;
export const PythonLanguage = 'python' as const;

export const Languages = [...CFamilyLanguages, PythonLanguage] as const;

export type CompileOptions = {
  language: (typeof Languages)[number];
};

export interface Executable {
  run(): Promise<UnprocessedExecResult>;
}

type ExecutableOptions = {
  maxOutput: number;
  timeout: number;
};

class NativeExecutable implements Executable {
  constructor(
    private readonly executable: string,
    private readonly args: string[],
    private readonly cwd: string,
    private readonly options: ExecutableOptions,
  ) {}

  run(): Promise<UnprocessedExecResult> {
    return sandbox(`./${this.executable}`, this.args, {
      timeoutMs: this.options.timeout,
      maxOutput: this.options.maxOutput,
      customCwd: this.cwd,
    });
  }
}

export type CompileResultSuccess = {
  kind: 'success';
  executable: Executable;
};
export type CompileResultFailure = {
  kind: 'failure';
  code: number;
  error: string;
  truncated: boolean;
};
export type CompileResult = CompileResultSuccess | CompileResultFailure;

async function compileCFamily(
  code: string,
  cwd: string,
  language: (typeof CFamilyLanguages)[number],
  { maxOutput, timeoutCompile, timeoutRun }: CompilerOptions,
): Promise<CompileResult> {
  const executable = 'a.out';
  let command: string;
  switch (language) {
    case 'c':
      command = 'gcc';
      break;
    case 'c++':
      command = 'g++';
      break;
  }
  const res = await execute(command, ['-o', executable, `-x${language}`, '-'], {
    timeoutMs: timeoutCompile,
    customCwd: cwd,
    input: code,
    maxOutput,
  });
  if (res.code === 0) {
    return {
      kind: 'success',
      executable: new NativeExecutable(executable, [], cwd, {
        timeout: timeoutRun,
        maxOutput,
      }),
    };
  } else {
    return {
      kind: 'failure',
      code: res.code,
      error: res.stderr,
      truncated: res.truncated,
    };
  }
}

class PythonExecutable implements Executable {
  constructor(
    private readonly code: string,
    private readonly cwd: string,
    private readonly options: ExecutableOptions,
  ) {}

  async run(): Promise<UnprocessedExecResult> {
    return sandbox('python', ['-'], {
      timeoutMs: this.options.timeout,
      maxOutput: this.options.maxOutput,
      customCwd: this.cwd,
      input: this.code,
    });
  }
}

function compilePython(
  code: string,
  cwd: string,
  { maxOutput, timeoutRun }: CompilerOptions,
): CompileResult {
  return {
    kind: 'success',
    executable: new PythonExecutable(code, cwd, {
      timeout: timeoutRun,
      maxOutput,
    }),
  };
}

export class Compiler {
  constructor(private readonly options: CompilerOptions) {}
  async compile(
    code: string,
    cwd: string,
    { language }: CompileOptions,
  ): Promise<CompileResult> {
    if (CFamilyLanguages.includes(language as any)) {
      return compileCFamily(
        code,
        cwd,
        language as (typeof CFamilyLanguages)[number],
        this.options,
      );
    } else if (language === PythonLanguage) {
      return compilePython(code, cwd, this.options);
    } else {
      return {
        kind: 'failure',
        code: -1,
        error: `Unsupported language: ${language}`,
        truncated: false,
      };
    }
  }
}
