import { execFile as nodeExecFile, execFileSync as nodeExecFileSync } from 'node:child_process';
import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync, readdirSync as nodeReaddirSync } from 'node:fs';
import { homedir as nodeHomedir } from 'node:os';
import path from 'node:path';

type ExecFileSync = (
  file: string,
  args: string[],
  options?: { encoding?: BufferEncoding; env?: NodeJS.ProcessEnv; stdio?: 'ignore' | 'pipe'; timeout?: number },
) => string | Buffer;

type ExecFile = (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; env: NodeJS.ProcessEnv; timeout: number },
) => Promise<string>;

export type CodexExecutableDiscoveryDependencies = {
  env?: NodeJS.ProcessEnv;
  /** Asynchronous login-shell runner used by `resolveCodexRuntime`. */
  execFile?: ExecFile;
  execFileSync?: ExecFileSync;
  existsSync?: (filePath: string) => boolean;
  homedir?: () => string;
  pathDelimiter?: string;
  platform?: NodeJS.Platform;
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string;
  readdirSync?: (dirPath: string) => string[];
  shell?: string;
  /** Upper bound for each login-shell probe. Defaults to 5 seconds. */
  shellTimeoutMs?: number;
};

export type CodexRuntime = {
  command: string;
  env: NodeJS.ProcessEnv;
};

export type ResolveCodexRuntimeOptions = {
  command?: string;
  env?: NodeJS.ProcessEnv;
  discovery?: CodexExecutableDiscoveryDependencies;
};

type ShellProbe = {
  path: string | null;
  nvmNodePath: string | null;
};

const DEFAULT_SHELL_TIMEOUT_MS = 5_000;
const emptyShellProbe: ShellProbe = { path: null, nvmNodePath: null };
const shellProbeCache = new Map<string, Promise<ShellProbe>>();

export function discoverCodexExecutable(
  dependencies: CodexExecutableDiscoveryDependencies = {},
): string | null {
  return findExecutable('codex', codexRuntimePathEntries(dependencies), dependencies);
}

export function codexRuntimePathEntries(
  dependencies: CodexExecutableDiscoveryDependencies = {},
): string[] {
  return runtimePathEntries(probeLoginShellSync(dependencies), dependencies);
}

export function withCodexRuntimePath(
  env: NodeJS.ProcessEnv | undefined,
  dependencies: CodexExecutableDiscoveryDependencies = {},
): NodeJS.ProcessEnv {
  const mergedEnv = { ...process.env, ...env };
  return withPathEntries(mergedEnv, codexRuntimePathEntries({ ...dependencies, env: mergedEnv }), dependencies);
}

/**
 * Resolves the Codex command and child-process environment without blocking
 * the event loop. Login-shell probes run concurrently, are bounded by
 * `shellTimeoutMs`, and are cached per shell, PATH, and home directory for the
 * life of the process, so reconnects do not spawn shells again.
 */
export async function resolveCodexRuntime(options: ResolveCodexRuntimeOptions = {}): Promise<CodexRuntime> {
  const env = { ...process.env, ...options.env };
  const dependencies = { ...options.discovery, env };
  const entries = runtimePathEntries(await probeLoginShell(dependencies), dependencies);
  return {
    command: options.command?.trim() || findExecutable('codex', entries, dependencies) || 'codex',
    env: withPathEntries(env, entries, dependencies),
  };
}

function runtimePathEntries(probe: ShellProbe, dependencies: CodexExecutableDiscoveryDependencies): string[] {
  const delimiter = pathDelimiter(dependencies);
  const env = dependencies.env ?? process.env;
  return unique([
    ...bundledApplicationBinaryPaths(dependencies),
    ...pathEntries(env.PATH, delimiter),
    ...pathEntries(probe.path, delimiter),
    ...commonUserBinaryPaths(dependencies),
    ...nvmBinaryPaths(probe, dependencies),
  ]);
}

function withPathEntries(
  env: NodeJS.ProcessEnv,
  entries: string[],
  dependencies: CodexExecutableDiscoveryDependencies,
): NodeJS.ProcessEnv {
  return { ...env, PATH: entries.join(pathDelimiter(dependencies)) };
}

function bundledApplicationBinaryPaths(dependencies: CodexExecutableDiscoveryDependencies): string[] {
  if ((dependencies.platform ?? process.platform) !== 'darwin') return [];
  return [
    '/Applications/ChatGPT.app/Contents/Resources',
    '/Applications/Codex.app/Contents/Resources',
  ].filter((entry) => executableExists(path.join(entry, 'codex'), dependencies));
}

function findExecutable(
  executable: string,
  entries: string[],
  dependencies: CodexExecutableDiscoveryDependencies,
): string | null {
  for (const entry of entries) {
    for (const candidate of executableCandidates(executable, dependencies)) {
      const filePath = path.join(entry, candidate);
      if (executableExists(filePath, dependencies)) {
        return filePath;
      }
    }
  }
  return null;
}

function probeLoginShellSync(dependencies: CodexExecutableDiscoveryDependencies): ShellProbe {
  if (isWindows(dependencies)) return emptyShellProbe;
  const run = (args: string[]): string | null => {
    try {
      return (dependencies.execFileSync ?? nodeExecFileSync)(loginShell(dependencies), args, {
        encoding: 'utf8',
        env: dependencies.env ?? process.env,
        stdio: 'pipe',
        timeout: shellTimeoutMs(dependencies),
      }).toString();
    } catch {
      return null;
    }
  };
  return {
    path: run(['-l', '-c', pathCommand(dependencies)]),
    nvmNodePath: run(['-l', '-c', 'nvm which current'])?.trim() || null,
  };
}

function probeLoginShell(dependencies: CodexExecutableDiscoveryDependencies): Promise<ShellProbe> {
  if (isWindows(dependencies)) return Promise.resolve(emptyShellProbe);
  if (dependencies.execFile || dependencies.execFileSync) return runLoginShellProbe(dependencies);
  const env = dependencies.env ?? process.env;
  const key = [loginShell(dependencies), env.PATH ?? '', homeDir(dependencies)].join('\u0000');
  let probe = shellProbeCache.get(key);
  if (!probe) {
    probe = runLoginShellProbe(dependencies);
    shellProbeCache.set(key, probe);
  }
  return probe;
}

async function runLoginShellProbe(dependencies: CodexExecutableDiscoveryDependencies): Promise<ShellProbe> {
  // Hosts that inject only a synchronous runner keep their existing contract.
  if (!dependencies.execFile && dependencies.execFileSync) return probeLoginShellSync(dependencies);
  const run = loginShellRunner(dependencies);
  const [shellPath, nvmNodePath] = await Promise.all([
    run(['-l', '-c', pathCommand(dependencies)]),
    run(['-l', '-c', 'nvm which current']),
  ]);
  return { path: shellPath, nvmNodePath: nvmNodePath?.trim() || null };
}

function loginShellRunner(
  dependencies: CodexExecutableDiscoveryDependencies,
): (args: string[]) => Promise<string | null> {
  const shell = loginShell(dependencies);
  const env = dependencies.env ?? process.env;
  const timeout = shellTimeoutMs(dependencies);
  if (dependencies.execFile) {
    const execFile = dependencies.execFile;
    return (args) => withTimeout(execFile(shell, args, { encoding: 'utf8', env, timeout }), timeout);
  }
  return (args) => withTimeout(new Promise<string>((resolve, reject) => {
    nodeExecFile(shell, args, { encoding: 'utf8', env, timeout, killSignal: 'SIGKILL' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  }), timeout);
}

// A login shell can leave a background process holding stdout open after the
// shell itself is killed, so the probe resolves on its own deadline too.
function withTimeout(promise: Promise<string>, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 100);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(String(value)); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

function pathCommand(dependencies: CodexExecutableDiscoveryDependencies): string {
  const shell = loginShell(dependencies);
  return shell.endsWith('/nu') || shell === 'nu' ? 'print $env.PATH' : 'printf "%s" "$PATH"';
}

function loginShell(dependencies: CodexExecutableDiscoveryDependencies): string {
  return dependencies.shell ?? dependencies.env?.SHELL ?? process.env.SHELL ?? '/bin/bash';
}

function shellTimeoutMs(dependencies: CodexExecutableDiscoveryDependencies): number {
  return dependencies.shellTimeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS;
}

function commonUserBinaryPaths(dependencies: CodexExecutableDiscoveryDependencies): string[] {
  if (isWindows(dependencies)) {
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

function nvmBinaryPaths(probe: ShellProbe, dependencies: CodexExecutableDiscoveryDependencies): string[] {
  if (isWindows(dependencies)) {
    return [];
  }
  const commandPath = probe.nvmNodePath && executableExists(probe.nvmNodePath, dependencies)
    ? path.dirname(probe.nvmNodePath)
    : null;
  return unique([commandPath, nvmBinaryPathFromFiles(dependencies)]);
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
      .filter((version) => version.startsWith(current))
      .sort()
      .at(-1);
    return best ? path.join(versionsPath, best, 'bin') : null;
  } catch {}
  return null;
}

function executableCandidates(executable: string, dependencies: CodexExecutableDiscoveryDependencies): string[] {
  if (!isWindows(dependencies) || path.extname(executable)) {
    return [executable];
  }
  const pathExt = dependencies.env?.PATHEXT ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
  return [executable, ...pathExt.split(';').filter(Boolean).map((extension) => `${executable}${extension.toLowerCase()}`)];
}

function isWindows(dependencies: CodexExecutableDiscoveryDependencies): boolean {
  return (dependencies.platform ?? process.platform) === 'win32';
}

function pathEntries(value: string | undefined | null, delimiter: string): string[] {
  return value ? value.split(delimiter).map((entry) => entry.trim()) : [];
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
