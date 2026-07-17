import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import type { RpcMessage, RpcTransport } from '../codex/wire';

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
  onExit?: (exit: CodexAppServerExit) => void;
  onStderr?: (text: string) => void;
  spawnProcess?: typeof spawn;
};

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

    const command = this.options.command?.trim() || 'codex';
    const configArgs = this.options.configOverrides?.flatMap((override) => ['-c', override]) ?? [];
    const args = [...configArgs, 'app-server', '--listen', 'stdio://'];
    const env = {
      ...process.env,
      ...this.options.env,
      ...(this.options.codexHome ? { CODEX_HOME: this.options.codexHome } : {}),
    };
    const spawnOptions: SpawnOptionsWithoutStdio = {
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env,
      stdio: 'pipe',
    };
    const child = (this.options.spawnProcess ?? spawn)(command, args, spawnOptions);
    this.child = child;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string | Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf('\n');
        if (line) {
          this.parseLine(line);
        }
      }
    });
    child.stderr.on('data', (chunk: string | Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      this.options.onStderr?.(text);
    });
    child.once('error', (error) => {
      if (this.child === child) {
        this.child = null;
      }
      this.emitError(error);
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
    child.kill();
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
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

