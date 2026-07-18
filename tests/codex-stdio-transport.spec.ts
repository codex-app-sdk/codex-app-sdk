import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerStdioTransport } from '../src/node';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

type FakeChild = EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new EventEmitter() as FakeChild['stdin'];
  child.stdin.write = vi.fn();
  child.stdout = new EventEmitter() as FakeChild['stdout'];
  child.stdout.setEncoding = vi.fn();
  child.stderr = new EventEmitter() as FakeChild['stderr'];
  child.stderr.setEncoding = vi.fn();
  child.kill = vi.fn();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

describe('CodexAppServerStdioTransport', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts Codex app-server with isolated configuration and writes JSONL', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({
      codexHome: '/tmp/codex-home',
      command: 'custom-codex',
      configOverrides: ['features.apps=true'],
      cwd: '/tmp/project',
      env: { SURFACE_TEST: 'yes' },
      executableDiscovery: {
        execFileSync: vi.fn(() => ''),
        existsSync: vi.fn(() => false),
      },
    });

    await transport.start();
    await transport.start();
    transport.send({ id: 1, method: 'initialize', params: {} });

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledWith(
      'custom-codex',
      ['-c', 'features.apps=true', 'app-server', '--listen', 'stdio://'],
      expect.objectContaining({
        cwd: '/tmp/project',
        env: expect.objectContaining({ CODEX_HOME: '/tmp/codex-home', SURFACE_TEST: 'yes' }),
        stdio: 'pipe',
      }),
    );
    expect(child.stdin.write).toHaveBeenCalledWith('{"id":1,"method":"initialize","params":{}}\n');
    expect(child.stdout.setEncoding).toHaveBeenCalledWith('utf8');
    expect(child.stderr.setEncoding).toHaveBeenCalledWith('utf8');
  });

  it('frames partial and multiple JSONL messages and reports malformed lines', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({
      executableDiscovery: { execFileSync: vi.fn(() => ''), existsSync: vi.fn(() => false) },
    });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    const unsubscribeMessage = transport.onMessage((message) => messages.push(message));
    const unsubscribeError = transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', '{"id":1,"res');
    child.stdout.emit('data', 'ult":{}}\n\n{"method":"turn/started"}\nnot-json\n');
    unsubscribeMessage();
    unsubscribeError();
    child.stdout.emit('data', '{"ignored":true}\n');

    expect(messages).toStrictEqual([
      { id: 1, result: {} },
      { method: 'turn/started' },
    ]);
    expect(errors).toHaveLength(1);
  });

  it('accepts app-server responses larger than the former four-megabyte default', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport();
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));
    await transport.start();

    const payload = 'x'.repeat(4 * 1024 * 1024 + 1);
    child.stdout.emit('data', `${JSON.stringify({ id: 1, result: { payload } })}\n`);

    expect(errors).toStrictEqual([]);
    expect(messages).toHaveLength(1);
    expect((messages[0] as { result: { payload: string } }).result.payload).toHaveLength(payload.length);
  });

  it('correlates and discards an oversized partial frame through its newline', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ maxOutputLineChars: 32 });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', '{"id":7,"result":{"payload":"xxxxxxxxxxxx');
    child.stdout.emit('data', 'looks-valid"}}\n{"id":8,"result":{}}\n');

    expect(messages).toStrictEqual([{ id: 8, result: {} }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'Codex app-server output line exceeded the configured limit',
      requestId: 7,
    });
  });

  it('surfaces stderr and unexpected process termination', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const onStderr = vi.fn();
    const onExit = vi.fn();
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport({
      executableDiscovery: { execFileSync: vi.fn(() => ''), existsSync: vi.fn(() => false) },
      onExit,
      onStderr,
    });
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stderr.emit('data', 'permission denied\n');
    child.emit('exit', 1, null);

    expect(onStderr).toHaveBeenCalledWith('permission denied\n');
    expect(onExit).toHaveBeenCalledWith({ code: 1, signal: null, stderr: 'permission denied' });
    expect(errors[0]?.message).toBe('Codex app-server exited (1): permission denied');
  });

  it('bounds diagnostics and rejects oversized output frames without disconnecting', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const onExit = vi.fn();
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport({
      maxDiagnosticBufferChars: 4,
      maxOutputLineChars: 5,
      onExit,
    });
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stderr.emit('data', 'abcdef');
    child.stdout.emit('data', '123456\n');
    child.stdout.emit('data', 'abcdef');
    child.emit('exit', 1, null);

    expect(onExit).toHaveBeenCalledWith({ code: 1, signal: null, stderr: 'cdef' });
    expect(errors.map((error) => error.message)).toStrictEqual([
      'Codex app-server output line exceeded the configured limit',
      'Codex app-server output line exceeded the configured limit',
      'Codex app-server exited (1): cdef',
    ]);
  });

  it('reports spawn errors and treats explicit close as expected', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport({
      command: '  ',
      executableDiscovery: { execFileSync: vi.fn(() => ''), existsSync: vi.fn(() => false) },
    });
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.emit('error', new Error('spawn failed'));
    expect(errors).toHaveLength(1);

    const replacement = createFakeChild();
    spawnMock.mockReturnValue(replacement);
    await transport.start();
    const closing = transport.close();
    replacement.emit('exit', null, 'SIGTERM');
    await closing;
    await transport.close();

    expect(spawnMock).toHaveBeenLastCalledWith('codex', ['app-server', '--listen', 'stdio://'], expect.any(Object));
    expect(replacement.kill).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(() => transport.send({ method: 'initialized' })).toThrow('Codex app-server transport is not started');
  });

  it('surfaces stdin failures once and terminates the unusable child', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport();
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdin.emit('error', new Error('write EPIPE'));
    child.emit('exit', 1, null);

    expect(child.kill).toHaveBeenCalledOnce();
    expect(errors.map((error) => error.message)).toStrictEqual(['write EPIPE']);
    expect(() => transport.send({ method: 'initialized' })).toThrow('Codex app-server transport is not started');
  });

  it('escalates shutdown to SIGKILL and rejects if the child still does not exit', async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ shutdownTimeoutMs: 10 });
    await transport.start();

    const closing = transport.close();
    const rejection = expect(closing).rejects.toThrow('Codex app-server did not exit after SIGKILL');
    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenNthCalledWith(1);
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
  });

  it('resolves shutdown when the child exits after SIGKILL', async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ shutdownTimeoutMs: 10 });
    await transport.start();

    const closing = transport.close();
    await vi.advanceTimersByTimeAsync(10);
    child.emit('exit', null, 'SIGKILL');

    await expect(closing).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });
});
