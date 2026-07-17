import { execFileSync as nodeExecFileSync } from 'node:child_process';
import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync, readdirSync as nodeReaddirSync } from 'node:fs';
import { homedir as nodeHomedir } from 'node:os';
import path from 'node:path';

type ExecFileSync = (
  file: string,
  args: string[],
  options?: { encoding?: BufferEncoding; env?: NodeJS.ProcessEnv; stdio?: 'ignore' | 'pipe' },
) => string | Buffer;

export type CodexExecutableDiscoveryDependencies = {
  env?: NodeJS.ProcessEnv;
  execFileSync?: ExecFileSync;
  existsSync?: (filePath: string) => boolean;
  homedir?: () => string;
  pathDelimiter?: string;
  platform?: NodeJS.Platform;
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string;
  readdirSync?: (dirPath: string) => string[];
  shell?: string;
};

export function discoverCodexExecutable(
  dependencies: CodexExecutableDiscoveryDependencies = {},
): string | null {
  return resolveExecutable('codex', dependencies);
}

export function codexRuntimePathEntries(
  dependencies: CodexExecutableDiscoveryDependencies = {},
): string[] {
  const delimiter = pathDelimiter(dependencies);
  const env = dependencies.env ?? process.env;
  return unique([
    ...pathEntries(env.PATH, delimiter),
    ...pathEntries(loginShellPath(dependencies), delimiter),
    ...commonUserBinaryPaths(dependencies),
    ...nvmBinaryPaths(dependencies),
  ]);
}

export function withCodexRuntimePath(
  env: NodeJS.ProcessEnv | undefined,
  dependencies: CodexExecutableDiscoveryDependencies = {},
): NodeJS.ProcessEnv {
  const mergedEnv = { ...process.env, ...env };
  return {
    ...mergedEnv,
    PATH: codexRuntimePathEntries({ ...dependencies, env: mergedEnv }).join(pathDelimiter(dependencies)),
  };
}

function resolveExecutable(
  executable: string,
  dependencies: CodexExecutableDiscoveryDependencies,
): string | null {
  for (const entry of codexRuntimePathEntries(dependencies)) {
    for (const candidate of executableCandidates(executable, dependencies)) {
      const filePath = path.join(entry, candidate);
      if (executableExists(filePath, dependencies)) {
        return filePath;
      }
    }
  }
  return null;
}

function loginShellPath(dependencies: CodexExecutableDiscoveryDependencies): string | null {
  if ((dependencies.platform ?? process.platform) === 'win32') {
    return null;
  }

  const shell = dependencies.shell ?? dependencies.env?.SHELL ?? process.env.SHELL ?? '/bin/bash';
  const command = shell.endsWith('/nu') || shell === 'nu' ? 'print $env.PATH' : 'printf "%s" "$PATH"';
  try {
    return (dependencies.execFileSync ?? nodeExecFileSync)(shell, ['-l', '-c', command], {
      encoding: 'utf8',
      env: dependencies.env ?? process.env,
      stdio: 'pipe',
    }).toString().trim();
  } catch {
    return null;
  }
}

function commonUserBinaryPaths(dependencies: CodexExecutableDiscoveryDependencies): string[] {
  if ((dependencies.platform ?? process.platform) === 'win32') {
    return [];
  }

  const home = homeDir(dependencies);
  return [
    path.join(home, '.local/bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter((entry) => executableExists(entry, dependencies));
}

function nvmBinaryPaths(dependencies: CodexExecutableDiscoveryDependencies): string[] {
  if ((dependencies.platform ?? process.platform) === 'win32') {
    return [];
  }
  return unique([nvmBinaryPathFromCommand(dependencies), nvmBinaryPathFromFiles(dependencies)]);
}

function nvmBinaryPathFromCommand(dependencies: CodexExecutableDiscoveryDependencies): string | null {
  const shell = dependencies.shell ?? dependencies.env?.SHELL ?? process.env.SHELL ?? '/bin/bash';
  try {
    const nodePath = (dependencies.execFileSync ?? nodeExecFileSync)(shell, ['-l', '-c', 'nvm which current'], {
      encoding: 'utf8',
      env: dependencies.env ?? process.env,
      stdio: 'pipe',
    }).toString().trim();
    return executableExists(nodePath, dependencies) ? path.dirname(nodePath) : null;
  } catch {
    return null;
  }
}

function nvmBinaryPathFromFiles(dependencies: CodexExecutableDiscoveryDependencies): string | null {
  const home = homeDir(dependencies);
  const aliasPath = path.join(home, '.nvm/alias/default');
  const versionsPath = path.join(home, '.nvm/versions/node');
  if (!executableExists(aliasPath, dependencies) || !executableExists(versionsPath, dependencies)) {
    return null;
  }

  try {
    let current = (dependencies.readFileSync ?? nodeReadFileSync)(aliasPath, 'utf8').trim();
    if (!current) {
      return null;
    }
    if (!current.startsWith('v')) {
      current = `v${current}`;
    }
    const best = (dependencies.readdirSync ?? nodeReaddirSync)(versionsPath)
      .filter((version) => version === current || version.startsWith(current))
      .sort()
      .at(-1);
    return best ? path.join(versionsPath, best, 'bin') : null;
  } catch {
    return null;
  }
}

function executableCandidates(executable: string, dependencies: CodexExecutableDiscoveryDependencies): string[] {
  if ((dependencies.platform ?? process.platform) !== 'win32' || path.extname(executable)) {
    return [executable];
  }
  const pathExt = dependencies.env?.PATHEXT ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
  return [executable, ...pathExt.split(';').filter(Boolean).map((extension) => `${executable}${extension.toLowerCase()}`)];
}

function pathEntries(value: string | undefined | null, delimiter: string): string[] {
  return value ? value.split(delimiter).map((entry) => entry.trim()).filter(Boolean) : [];
}

function unique(entries: Array<string | null | undefined>): string[] {
  return [...new Set(entries.filter((entry): entry is string => Boolean(entry)))];
}

function executableExists(filePath: string, dependencies: CodexExecutableDiscoveryDependencies): boolean {
  return (dependencies.existsSync ?? nodeExistsSync)(filePath);
}

function homeDir(dependencies: CodexExecutableDiscoveryDependencies): string {
  return dependencies.homedir?.() ?? dependencies.env?.HOME ?? process.env.HOME ?? nodeHomedir();
}

function pathDelimiter(dependencies: CodexExecutableDiscoveryDependencies): string {
  return dependencies.pathDelimiter ?? path.delimiter;
}
