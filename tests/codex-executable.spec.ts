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
});
