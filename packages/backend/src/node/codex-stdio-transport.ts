import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { constants as bufferConstants } from 'node:buffer';
import { RpcTransportProtocolError, type RpcMessage, type RpcTransport } from '../codex/wire';
import {
  discoverCodexExecutable,
  withCodexRuntimePath,
  type CodexExecutableDiscoveryDependencies,
} from './codex-executable';

export type CodexAppServerExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
};

export type CodexAppServerStdioTransportOptions = {
  command?: string;
  configOverrides?: string[];
  codexHome?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  executableDiscovery?: CodexExecutableDiscoveryDependencies;
  onExit?: (exit: CodexAppServerExit) => void;
  onStderr?: (text: string) => void;
  spawnProcess?: typeof spawn;
  shutdownTimeoutMs?: number;
  maxDiagnosticBufferChars?: number;
  maxOutputLineChars?: number;
};

const DEFAULT_DIAGNOSTIC_BUFFER_CHARS = 64 * 1024;
const DEFAULT_OUTPUT_LINE_CHARS = Math.min(
  256 * 1024 * 1024,
  Math.floor(bufferConstants.MAX_STRING_LENGTH / 2),
);
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000;

export class CodexAppServerStdioTransport implements RpcTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly expectedExits = new WeakSet<ChildProcessWithoutNullStreams>();
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(private readonly options: CodexAppServerStdioTransportOptions = {}) {}

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const env = withCodexRuntimePath(this.options.env, this.options.executableDiscovery);
    const command = this.options.command?.trim()
      || discoverCodexExecutable({ ...this.options.executableDiscovery, env })
      || 'codex';
    const configArgs = this.options.configOverrides?.flatMap((override) => ['-c', override]) ?? [];
    const args = [...configArgs, 'app-server', '--listen', 'stdio://'];
    const processEnv = {
      ...env,
      ...(this.options.codexHome ? { CODEX_HOME: this.options.codexHome } : {}),
    };
    const spawnOptions: SpawnOptionsWithoutStdio = {
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env: processEnv,
      stdio: 'pipe',
    };
    const child = (this.options.spawnProcess ?? spawn)(command, args, spawnOptions);
    this.child = child;
    let stdoutBuffer = '';
    let discardingOversizedLine = false;
    let stderrBuffer = '';
    const maxDiagnosticBufferChars = Math.max(1, this.options.maxDiagnosticBufferChars ?? DEFAULT_DIAGNOSTIC_BUFFER_CHARS);
    const maxOutputLineChars = Math.max(1, this.options.maxOutputLineChars ?? DEFAULT_OUTPUT_LINE_CHARS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string | Buffer) => {
      let text = chunk.toString();
      if (discardingOversizedLine) {
        const discardedLineEnd = text.indexOf('\n');
        if (discardedLineEnd < 0) return;
        discardingOversizedLine = false;
        text = text.slice(discardedLineEnd + 1);
      }
      stdoutBuffer += text;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf('\n');
        if (line) {
          if (line.length > maxOutputLineChars) {
            this.emitError(new RpcTransportProtocolError(
              'Codex app-server output line exceeded the configured limit',
              { requestId: rpcResponseIdFromPrefix(line) },
            ));
          } else {
            this.parseLine(line);
          }
        }
      }
      if (stdoutBuffer.length > maxOutputLineChars) {
        const requestId = rpcResponseIdFromPrefix(stdoutBuffer);
        stdoutBuffer = '';
        discardingOversizedLine = true;
        this.emitError(new RpcTransportProtocolError(
          'Codex app-server output line exceeded the configured limit',
          { requestId },
        ));
      }
    });
    child.stderr.on('data', (chunk: string | Buffer) => {
      const text = chunk.toString();
      stderrBuffer = appendBounded(stderrBuffer, text, maxDiagnosticBufferChars);
      this.options.onStderr?.(text);
    });
    child.stdin.on('error', (error) => {
      if (this.child !== child || this.expectedExits.has(child)) return;
      this.child = null;
      this.expectedExits.add(child);
      child.kill();
      this.emitError(error);
    });
    child.once('error', (error) => {
      if (this.child === child) {
        this.child = null;
      }
      if (!this.expectedExits.has(child)) {
        this.expectedExits.add(child);
        this.emitError(error);
      }
    });
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null;
      }
      const exit = { code, signal, stderr: stderrBuffer.trim() };
      this.options.onExit?.(exit);
      if (!this.expectedExits.has(child)) {
        const status = code ?? signal ?? 'unknown';
        const detail = exit.stderr ? `: ${exit.stderr}` : '';
        this.emitError(new Error(`Codex app-server exited (${status})${detail}`));
      }
    });
  }

  send(message: RpcMessage): void {
    if (!this.child) {
      throw new Error('Codex app-server transport is not started');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) {
      return;
    }
    this.expectedExits.add(child);
    const shutdownTimeoutMs = this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    const gracefulExit = waitForExit(child, shutdownTimeoutMs);
    child.kill();
    if (await gracefulExit) return;

    const forcedExit = waitForExit(child, shutdownTimeoutMs);
    child.kill('SIGKILL');
    if (!await forcedExit) {
      throw new Error('Codex app-server did not exit after SIGKILL');
    }
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private parseLine(line: string): void {
    try {
      const message: unknown = JSON.parse(line);
      for (const listener of this.messageListeners) {
        listener(message);
      }
    } catch (error) {
      this.emitError(new RpcTransportProtocolError(
        'Codex app-server sent malformed JSON',
        { cause: error },
      ));
    }
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

function appendBounded(current: string, chunk: string, limit: number): string {
  return (current + chunk).slice(-limit);
}

function rpcResponseIdFromPrefix(frame: string): string | number | undefined {
  const match = /^\s*\{\s*"id"\s*:\s*(?:(-?\d+)|("(?:\\.|[^"\\])*"))/.exec(frame);
  if (!match) return undefined;
  if (match[1] !== undefined) {
    const id = Number(match[1]);
    return Number.isSafeInteger(id) ? id : undefined;
  }
  try {
    return JSON.parse(match[2] as string) as string;
  } catch {}
  return undefined;
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, Math.max(0, timeoutMs));
    child.once('exit', onExit);
  });
}
