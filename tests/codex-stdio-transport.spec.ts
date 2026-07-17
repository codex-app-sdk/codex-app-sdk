import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerStdioTransport } from '../src/node';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

type FakeChild = EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = { write: vi.fn() };
  child.stdout = new EventEmitter() as FakeChild['stdout'];
  child.stdout.setEncoding = vi.fn();
  child.stderr = new EventEmitter() as FakeChild['stderr'];
  child.stderr.setEncoding = vi.fn();
  child.kill = vi.fn();
  return child;
}

describe('CodexAppServerStdioTransport', () => {
  beforeEach(() => {
    spawnMock.mockReset();
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
    const transport = new CodexAppServerStdioTransport();
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

  it('surfaces stderr and unexpected process termination', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const onStderr = vi.fn();
    const onExit = vi.fn();
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport({ onExit, onStderr });
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stderr.emit('data', 'permission denied\n');
    child.emit('exit', 1, null);

    expect(onStderr).toHaveBeenCalledWith('permission denied\n');
    expect(onExit).toHaveBeenCalledWith({ code: 1, signal: null, stderr: 'permission denied' });
    expect(errors[0]?.message).toBe('Codex app-server exited (1): permission denied');
  });

  it('reports spawn errors and treats explicit close as expected', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport({ command: '  ' });
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.emit('error', new Error('spawn failed'));
    expect(errors).toHaveLength(1);

    const replacement = createFakeChild();
    spawnMock.mockReturnValue(replacement);
    await transport.start();
    await transport.close();
    await transport.close();
    replacement.emit('exit', null, 'SIGTERM');

    expect(spawnMock).toHaveBeenLastCalledWith('codex', ['app-server', '--listen', 'stdio://'], expect.any(Object));
    expect(replacement.kill).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(() => transport.send({ method: 'initialized' })).toThrow('Codex app-server transport is not started');
  });
});

