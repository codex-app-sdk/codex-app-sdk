import { describe, expect, it, vi } from 'vitest';
import {
  codexRuntimePathEntries,
  discoverCodexExecutable,
  withCodexRuntimePath,
} from '../src/node';

describe('Codex executable discovery', () => {
  it('merges current, login-shell, user, Homebrew, and nvm paths', () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce('/usr/local/bin:/usr/bin')
      .mockReturnValueOnce('/Users/nicolas/.nvm/versions/node/v22.19.0/bin/node');
    const existsSync = vi.fn((filePath: string) => [
      '/Users/nicolas/.local/bin',
      '/Users/nicolas/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/nicolas/.nvm/versions/node/v22.19.0/bin/node',
    ].includes(filePath));

    expect(codexRuntimePathEntries({
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' },
      execFileSync,
      existsSync,
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin',
    })).toStrictEqual([
      '/usr/bin',
      '/bin',
      '/usr/local/bin',
      '/Users/nicolas/.local/bin',
      '/Users/nicolas/bin',
      '/opt/homebrew/bin',
      '/Users/nicolas/.nvm/versions/node/v22.19.0/bin',
    ]);
  });

  it('falls back to the configured nvm version and resolves Codex', () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce('/usr/bin:/bin')
      .mockImplementationOnce(() => { throw new Error('nvm missing'); });
    const existsSync = vi.fn((filePath: string) => [
      '/Users/nicolas/.nvm/alias/default',
      '/Users/nicolas/.nvm/versions/node',
      '/Users/nicolas/.nvm/versions/node/v22.20.0/bin/codex',
    ].includes(filePath));

    expect(discoverCodexExecutable({
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' },
      execFileSync,
      existsSync,
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin',
      readFileSync: vi.fn(() => '22'),
      readdirSync: vi.fn(() => ['v20.11.1', 'v22.20.0']),
    })).toBe('/Users/nicolas/.nvm/versions/node/v22.20.0/bin/codex');
  });

  it('supports Windows executable extensions without shell discovery', () => {
    expect(discoverCodexExecutable({
      env: { PATH: 'C:\\Tools', PATHEXT: '.EXE;.CMD' },
      existsSync: vi.fn((filePath: string) => filePath.toLowerCase().endsWith('codex.cmd')),
      pathDelimiter: ';',
      platform: 'win32',
    })).toMatch(/codex\.cmd$/i);
  });

  it('returns an enriched copy of the process environment', () => {
    const env = withCodexRuntimePath({ PATH: '/usr/bin', SURFACE_TEST: '1' }, {
      execFileSync: vi.fn(() => '/opt/homebrew/bin:/usr/bin'),
      existsSync: vi.fn(() => false),
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin',
    });

    expect(env.SURFACE_TEST).toBe('1');
    expect(env.PATH).toBe('/usr/bin:/opt/homebrew/bin');
  });

  it('supports Nushell discovery, HOME fallback, and an already-prefixed nvm version', () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce('/nu/bin')
      .mockImplementationOnce(() => { throw new Error('nvm unavailable'); });
    const existsSync = vi.fn((filePath: string) => [
      '/Users/from-env/.local/bin',
      '/Users/from-env/.nvm/alias/default',
      '/Users/from-env/.nvm/versions/node',
      '/Users/from-env/.nvm/versions/node/v24.1.0/bin/codex',
    ].includes(filePath));

    expect(discoverCodexExecutable({
      env: { HOME: '/Users/from-env', PATH: '', SHELL: '/bin/nu' },
      execFileSync,
      existsSync,
      pathDelimiter: ':',
      platform: 'darwin',
      readFileSync: vi.fn(() => 'v24.1.0'),
      readdirSync: vi.fn(() => ['v24.1.0']),
    })).toBe('/Users/from-env/.nvm/versions/node/v24.1.0/bin/codex');
    expect(execFileSync.mock.calls[0]?.[1]).toStrictEqual(['-l', '-c', 'print $env.PATH']);
  });

  it('handles empty or unreadable nvm aliases without inventing a path', () => {
    const base = {
      env: { PATH: '' },
      execFileSync: vi.fn(() => { throw new Error('shell unavailable'); }),
      existsSync: vi.fn((filePath: string) => filePath.endsWith('/.nvm/alias/default') || filePath.endsWith('/.nvm/versions/node')),
      homedir: () => '/Users/nicolas',
      pathDelimiter: ':',
      platform: 'darwin' as const,
      readdirSync: vi.fn(() => []),
    };
    expect(discoverCodexExecutable({ ...base, readFileSync: vi.fn(() => '') })).toBeNull();
    expect(discoverCodexExecutable({
      ...base,
      readFileSync: vi.fn(() => { throw new Error('unreadable'); }),
    })).toBeNull();
  });

  it('uses default Windows executable extensions when PATHEXT is absent', () => {
    expect(discoverCodexExecutable({
      env: { PATH: 'C:\\Tools', PATHEXT: undefined },
      existsSync: vi.fn((filePath: string) => filePath.toLowerCase().endsWith('codex.exe')),
      pathDelimiter: ';',
      platform: 'win32',
    })).toMatch(/codex\.exe$/i);
  });
});
