import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerStdioTransport, resolveCodexRuntime } from '../src/node';

type ExecFileCallback = (error: Error | null, stdout: string) => void;

const childProcess = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => childProcess);

const loginShellOutput = (file: string, args: string[], _options: unknown, callback: ExecFileCallback) => {
  callback(null, args.includes('nvm which current') ? '' : `/login-of-${file.split('/').at(-1)}`);
};

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.kill = vi.fn();
  return child;
}

describe('asynchronous Codex runtime resolution', () => {
  afterEach(() => {
    vi.useRealTimers();
    childProcess.execFile.mockReset();
    childProcess.spawn.mockReset();
  });

  it('probes the login shell without blocking and reuses the result for later connections', async () => {
    childProcess.execFile.mockImplementation(loginShellOutput);
    const options = {
      env: { PATH: '/cached-test/bin', SHELL: '/bin/cache-shell' },
      discovery: { existsSync: (filePath: string) => filePath === '/login-of-cache-shell/codex', platform: 'linux' as const },
    };

    const first = await resolveCodexRuntime(options);
    const second = await resolveCodexRuntime(options);

    expect(first).toStrictEqual(second);
    expect(first.command).toBe('/login-of-cache-shell/codex');
    expect(first.env.PATH?.split(':')).toStrictEqual(['/cached-test/bin', '/login-of-cache-shell']);
    expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    expect(childProcess.execFile).toHaveBeenCalledWith(
      '/bin/cache-shell',
      ['-l', '-c', 'printf "%s" "$PATH"'],
      expect.objectContaining({ timeout: 5_000, killSignal: 'SIGKILL' }),
      expect.any(Function),
    );
  });

  it('gives up on a login shell that never returns and still resolves Codex', async () => {
    vi.useFakeTimers();
    childProcess.execFile.mockImplementation(() => undefined);

    const resolution = resolveCodexRuntime({
      env: { PATH: '/hung-test/bin', SHELL: '/bin/hung-shell' },
      discovery: { existsSync: () => false, platform: 'linux', shellTimeoutMs: 50 },
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(resolution).resolves.toMatchObject({
      command: 'codex',
      env: { PATH: '/hung-test/bin' },
    });
  });

  it('does not spawn the app-server when closed while the runtime is resolving', async () => {
    const pendingProbes: Array<() => void> = [];
    childProcess.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: ExecFileCallback) => {
      pendingProbes.push(() => loginShellOutput(file, args, options, callback));
    });
    childProcess.spawn.mockReturnValue(fakeChild());
    const transport = new CodexAppServerStdioTransport({
      env: { PATH: '/closing-test/bin', SHELL: '/bin/closing-shell' },
      executableDiscovery: { existsSync: () => false, platform: 'linux' },
    });

    const starting = transport.start();
    await transport.close();
    for (const finishProbe of pendingProbes) finishProbe();

    await expect(starting).rejects.toThrow('closed while starting');
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});
