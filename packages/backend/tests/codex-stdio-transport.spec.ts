import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerStdioTransport } from '../src/node';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

type FakeChild = EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
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
  child.stdin.end = vi.fn();
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
  it('closes stdin and allows durable shutdown before sending any signal', async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport();
    await transport.start();
    const closing = transport.close();
    expect(child.stdin.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('exit', 0, null);
    await expect(closing).resolves.toBeUndefined();
  });

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
      [
        '-c',
        'features.default_mode_request_user_input=true',
        '-c',
        'features.apps=true',
        'app-server',
        '--listen',
        'stdio://',
      ],
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

  it('keeps CODEX_HOME isolated per transport and overrides only each child environment', async () => {
    const firstChild = createFakeChild();
    const secondChild = createFakeChild();
    spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const inheritedHome = process.env.CODEX_HOME;
    const discovery = { execFileSync: vi.fn(() => ''), existsSync: vi.fn(() => false) };

    await new CodexAppServerStdioTransport({
      codexHome: '/tmp/codex-home-a',
      env: { CODEX_HOME: '/tmp/inherited-a' },
      executableDiscovery: discovery,
    }).start();
    await new CodexAppServerStdioTransport({
      codexHome: '/tmp/codex-home-b',
      env: { CODEX_HOME: '/tmp/inherited-b' },
      executableDiscovery: discovery,
    }).start();

    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
      env: expect.objectContaining({ CODEX_HOME: '/tmp/codex-home-a' }),
    });
    expect(spawnMock.mock.calls[1]?.[2]).toMatchObject({
      env: expect.objectContaining({ CODEX_HOME: '/tmp/codex-home-b' }),
    });
    expect(process.env.CODEX_HOME).toBe(inheritedHome);
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

    expect(spawnMock).toHaveBeenLastCalledWith(
      'codex',
      ['-c', 'features.default_mode_request_user_input=true', 'app-server', '--listen', 'stdio://'],
      expect.any(Object),
    );
    expect(replacement.stdin.end).toHaveBeenCalledOnce();
    expect(replacement.kill).not.toHaveBeenCalled();
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
    await vi.advanceTimersByTimeAsync(10);
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
    await vi.advanceTimersByTimeAsync(20);
    expect(child.listenerCount('exit')).toBe(2);
    child.emit('exit', null, 'SIGKILL');

    await expect(closing).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('recovers from oversized discard mode when the next chunk starts with a newline', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ maxOutputLineChars: 20 });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', '{"id":7,"payload":"xxxxxxxx');
    child.stdout.emit('data', '\n{"id":8}\n');
    child.stdout.emit('data', '{"id":9}\n');

    expect(messages).toStrictEqual([{ id: 8 }, { id: 9 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ requestId: 7 });
  });

  it('keeps discarding an oversized frame until a later chunk supplies its newline', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ maxOutputLineChars: 20 });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', '{"id":7,"payload":"xxxxxxxx');
    child.stdout.emit('data', '{"id":8}');
    child.stdout.emit('data', '\n{"id":9}\n');

    expect(messages).toStrictEqual([{ id: 9 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ requestId: 7 });
  });

  it('ignores whitespace-only output lines', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport();
    const errors: Error[] = [];
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', '  \t  \n');

    expect(errors).toStrictEqual([]);
  });

  it('accepts complete and buffered JSON lines at the exact configured character limit', async () => {
    const frame = '{"id":123,"result":{}}';
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ maxOutputLineChars: frame.length });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', frame);
    expect(errors).toStrictEqual([]);
    child.stdout.emit('data', '\n');
    child.stdout.emit('data', `${frame}\n`);

    expect(messages).toStrictEqual([
      { id: 123, result: {} }, { id: 123, result: {} },
    ]);
    expect(errors).toStrictEqual([]);
  });

  it.each([
    ['  { "id" : -12,"result":{}}', -12],
    ['{"id":"escaped\\\\id","result":{}}', 'escaped\\id'],
    ['{"id":9007199254740992,"result":{}}', undefined],
    ['{"method":"event","payload":"large"}', undefined],
  ])('correlates oversized response prefixes %#', async (frame, requestId) => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ maxOutputLineChars: 5 });
    const errors: Error[] = [];
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', `${frame}\n`);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'Codex app-server output line exceeded the configured limit', requestId,
    });
  });

  it.each([
    ['junk before the object', 'junk {"id":12,"result":{}}'],
    ['non-whitespace prefix', 'x{"id":"request","result":{}}'],
    ['invalid JSON string escape', '{"id":"bad\\q","result":{}}'],
  ])('does not invent request correlation for %s', async (_label, frame) => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ maxOutputLineChars: 5 });
    const errors: Error[] = [];
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', `${frame}\n`);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'Codex app-server output line exceeded the configured limit', requestId: undefined,
    });
  });

  it('ignores stdin errors from stale and intentionally closing child processes', async () => {
    const first = createFakeChild();
    const second = createFakeChild();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport({ shutdownTimeoutMs: 10 });
    transport.onError((error) => errors.push(error));
    await transport.start();
    first.emit('error', new Error('first failed'));
    await transport.start();

    first.stdin.emit('error', new Error('stale write'));
    const closing = transport.close();
    second.stdin.emit('error', new Error('expected close write'));
    second.emit('exit', 0, null);
    await closing;

    expect(errors.map((error) => error.message)).toStrictEqual(['first failed']);
    expect(first.kill).not.toHaveBeenCalled();
    expect(second.stdin.end).toHaveBeenCalledOnce();
    expect(second.kill).not.toHaveBeenCalled();
  });

  it('ignores a late stdin error from an unexpectedly exited child after restart', async () => {
    const first = createFakeChild();
    const second = createFakeChild();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport();
    transport.onError((error) => errors.push(error));
    await transport.start();
    first.emit('exit', 1, null);
    await transport.start();

    first.stdin.emit('error', new Error('late stale write'));
    transport.send({ method: 'initialized' });

    expect(errors.map((error) => error.message)).toStrictEqual(['Codex app-server exited (1)']);
    expect(first.kill).not.toHaveBeenCalled();
    expect(second.stdin.write).toHaveBeenCalledWith('{"method":"initialized"}\n');
  });

  it('does not let late process errors or exits clear or report over a replacement child', async () => {
    const first = createFakeChild();
    const second = createFakeChild();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport();
    transport.onError((error) => errors.push(error));
    await transport.start();
    first.stdin.emit('error', new Error('first stdin failed'));
    await transport.start();

    first.emit('error', new Error('late process error'));
    first.emit('exit', 1, null);
    transport.send({ method: 'initialized' });

    expect(errors.map((error) => error.message)).toStrictEqual(['first stdin failed']);
    expect(second.stdin.write).toHaveBeenCalledWith('{"method":"initialized"}\n');
  });

  it('clears the active child after an unexpected exit', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport();
    await transport.start();

    child.emit('exit', 1, null);

    expect(() => transport.send({ method: 'initialized' })).toThrow(
      'Codex app-server transport is not started',
    );
  });

  it('reports a process error only once when its exit follows', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport();
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.emit('error', new Error('spawn failed'));
    child.emit('exit', 1, null);

    expect(errors.map((error) => error.message)).toStrictEqual(['spawn failed']);
  });

  it('suppresses process errors raised during an explicit close', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport();
    transport.onError((error) => errors.push(error));
    await transport.start();

    const closing = transport.close();
    child.emit('error', new Error('kill race'));
    child.emit('exit', 0, null);
    await closing;

    expect(errors).toStrictEqual([]);
  });

  it('reports signal and unknown unexpected exits without inventing stderr detail', async () => {
    for (const [code, signal, message] of [
      [null, 'SIGABRT', 'Codex app-server exited (SIGABRT)'],
      [null, null, 'Codex app-server exited (unknown)'],
    ] as const) {
      const child = createFakeChild();
      spawnMock.mockReturnValueOnce(child);
      const onExit = vi.fn();
      const errors: Error[] = [];
      const transport = new CodexAppServerStdioTransport({ onExit });
      transport.onError((error) => errors.push(error));
      await transport.start();

      child.emit('exit', code, signal);

      expect(onExit).toHaveBeenCalledWith({ code, signal, stderr: '' });
      expect(errors.map((error) => error.message)).toStrictEqual([message]);
    }
  });

  it('preserves diagnostics exactly at the configured bound and clamps non-positive limits', async () => {
    const exact = createFakeChild();
    const clamped = createFakeChild();
    spawnMock.mockReturnValueOnce(exact).mockReturnValueOnce(clamped);
    const exactExit = vi.fn();
    const clampedExit = vi.fn();
    const clampedErrors: Error[] = [];
    const exactTransport = new CodexAppServerStdioTransport({ maxDiagnosticBufferChars: 4, onExit: exactExit });
    const clampedTransport = new CodexAppServerStdioTransport({
      maxDiagnosticBufferChars: 0, maxOutputLineChars: 0, onExit: clampedExit,
    });
    clampedTransport.onError((error) => clampedErrors.push(error));
    await exactTransport.start();
    exact.stderr.emit('data', 'ab');
    exact.stderr.emit('data', 'cd');
    exact.emit('exit', 0, null);

    await clampedTransport.start();
    clamped.stderr.emit('data', 'abc');
    clamped.stdout.emit('data', '{}\n');
    clamped.emit('exit', 0, null);

    expect(exactExit).toHaveBeenCalledWith({ code: 0, signal: null, stderr: 'abcd' });
    expect(clampedExit).toHaveBeenCalledWith({ code: 0, signal: null, stderr: 'c' });
    expect(clampedErrors.map((error) => error.message)).toStrictEqual([
      'Codex app-server output line exceeded the configured limit',
      'Codex app-server exited (0): c',
    ]);
  });

  it('emits a precise protocol error for malformed JSON and honors error unsubscription', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport();
    const errors: Error[] = [];
    const unsubscribe = transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', 'not-json\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      name: 'RpcTransportProtocolError', message: 'Codex app-server sent malformed JSON',
      cause: expect.any(SyntaxError),
    });
    unsubscribe();
    child.stdout.emit('data', 'still-not-json\n');
    expect(errors).toHaveLength(1);
  });

  it('removes the graceful-exit timeout after an early exit', async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ shutdownTimeoutMs: 10 });
    await transport.start();

    const closing = transport.close();
    child.emit('exit', 0, null);
    await closing;

    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['exit code', { exitCode: 0, signalCode: null }],
    ['signal code', { exitCode: null, signalCode: 'SIGTERM' as NodeJS.Signals }],
  ])('closes immediately when the child already has an %s', async (_label, status) => {
    vi.useFakeTimers();
    const child = createFakeChild();
    Object.assign(child, status);
    spawnMock.mockReturnValue(child);
    const transport = new CodexAppServerStdioTransport({ shutdownTimeoutMs: 10 });
    await transport.start();

    await expect(transport.close()).resolves.toBeUndefined();

    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
