import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:buffer', () => ({
  constants: { MAX_STRING_LENGTH: 100 },
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

import { CodexAppServerStdioTransport } from '../src/node/codex-stdio-transport';

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.kill = vi.fn();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

describe('CodexAppServerStdioTransport default output limit', () => {
  it('uses half the runtime maximum string length as the safe default', async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const errors: Error[] = [];
    const transport = new CodexAppServerStdioTransport();
    transport.onError((error) => errors.push(error));
    await transport.start();

    child.stdout.emit('data', `${'x'.repeat(51)}\n`);

    expect(errors.map((error) => error.message)).toStrictEqual([
      'Codex app-server output line exceeded the configured limit',
    ]);
  });
});
