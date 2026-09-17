import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  codexRuntimePathEntries,
  discoverCodexExecutable,
  withCodexRuntimePath,
} from '../src/node';

describe('Codex executable discovery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it('prefers the bundled macOS Codex binary over unrelated PATH commands', () => {
    const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex';
    expect(discoverCodexExecutable({
      env: { PATH: '/unrelated/bin' },
      execFileSync: vi.fn(() => ''),
      existsSync: vi.fn((filePath: string) => filePath === bundled || filePath === '/unrelated/bin/codex'),
      platform: 'darwin',
    })).toBe(bundled);
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

  it('uses both bundled macOS locations in priority order and skips them elsewhere', () => {
    const chatGpt = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const codex = '/Applications/Codex.app/Contents/Resources/codex';
    const existsSync = vi.fn((filePath: string) => filePath === chatGpt || filePath === codex);
    const base = {
      env: { PATH: '' },
      execFileSync: vi.fn(() => { throw new Error('no shell'); }),
      existsSync,
      homedir: () => '/Users/test',
      pathDelimiter: ':',
    };

    expect(codexRuntimePathEntries({ ...base, platform: 'darwin' })).toStrictEqual([
      '/Applications/ChatGPT.app/Contents/Resources',
      '/Applications/Codex.app/Contents/Resources',
    ]);
    existsSync.mockClear();
    expect(codexRuntimePathEntries({ ...base, platform: 'linux' })).toStrictEqual([]);
    expect(existsSync.mock.calls.flat()).not.toContain(chatGpt);
    expect(existsSync.mock.calls.flat()).not.toContain(codex);
  });

  it('uses the explicit login shell, exact command, environment, and process options', () => {
    const env = { PATH: '/env/bin', SHELL: '/ignored/shell' };
    const execFileSync = vi.fn()
      .mockReturnValueOnce(Buffer.from('  /login/one:/login/two  \n'))
      .mockReturnValueOnce(Buffer.from('  /nvm/v22/bin/node  \n'));
    const existsSync = vi.fn((filePath: string) => filePath === '/nvm/v22/bin/node');

    expect(codexRuntimePathEntries({
      env,
      execFileSync,
      existsSync,
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux',
      shell: '/custom/zsh',
    })).toStrictEqual(['/env/bin', '/login/one', '/login/two', '/nvm/v22/bin']);
    expect(execFileSync).toHaveBeenNthCalledWith(1, '/custom/zsh', ['-l', '-c', 'printf "%s" "$PATH"'], {
      encoding: 'utf8', env, stdio: 'pipe',
    });
    expect(execFileSync).toHaveBeenNthCalledWith(2, '/custom/zsh', ['-l', '-c', 'nvm which current'], {
      encoding: 'utf8', env, stdio: 'pipe',
    });
  });

  it.each([
    ['/bin/nu', 'print $env.PATH'],
    ['nu', 'print $env.PATH'],
    ['/bin/bash', 'printf "%s" "$PATH"'],
  ])('selects the exact login command for shell %s', (shell, command) => {
    const execFileSync = vi.fn((_file: string) => '');
    codexRuntimePathEntries({
      env: { PATH: '' },
      execFileSync,
      existsSync: vi.fn(() => false),
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux',
      shell,
    });

    expect(execFileSync.mock.calls[0]?.slice(0, 2)).toStrictEqual([
      shell, ['-l', '-c', command],
    ]);
  });

  it('selects environment, process, and bash shell fallbacks in order', () => {
    vi.stubEnv('SHELL', '/process/fish');
    let execFileSync = vi.fn((_file: string) => '');
    codexRuntimePathEntries({
      env: { PATH: '', SHELL: '/environment/zsh' },
      execFileSync,
      existsSync: vi.fn(() => false),
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux',
    });

    expect(execFileSync.mock.calls.map(([shell]) => shell)).toStrictEqual([
      '/environment/zsh', '/environment/zsh',
    ]);

    execFileSync = vi.fn(() => '');
    codexRuntimePathEntries({
      execFileSync,
      existsSync: vi.fn(() => false),
      homedir: () => '/home/test',
      platform: 'linux',
    });

    expect(execFileSync).toHaveBeenNthCalledWith(1, '/process/fish', expect.any(Array), expect.objectContaining({
      env: process.env,
    }));
    expect(execFileSync).toHaveBeenNthCalledWith(2, '/process/fish', expect.any(Array), expect.objectContaining({
      env: process.env,
    }));

    vi.stubEnv('SHELL', undefined);
    execFileSync = vi.fn((_file: string) => '');
    codexRuntimePathEntries({
      env: { PATH: '', SHELL: undefined },
      execFileSync,
      existsSync: vi.fn(() => false),
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux',
    });

    expect(execFileSync.mock.calls.map(([shell]) => shell)).toStrictEqual(['/bin/bash', '/bin/bash']);
  });

  it('skips all shell, user, and nvm discovery on Windows', () => {
    const execFileSync = vi.fn(() => { throw new Error('must not run'); });
    const existsSync = vi.fn(() => false);

    expect(codexRuntimePathEntries({
      env: { HOME: 'C:\\Users\\test', PATH: 'C:\\One;C:\\Two' },
      execFileSync,
      existsSync,
      homedir: () => { throw new Error('must not resolve home'); },
      pathDelimiter: ';',
      platform: 'win32',
    })).toStrictEqual(['C:\\One', 'C:\\Two']);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(existsSync).not.toHaveBeenCalled();
  });

  it('includes only existing common user directories in their documented order', () => {
    const existsSync = vi.fn((filePath: string) => [
      '/explicit/home/.local/bin', '/usr/local/bin',
    ].includes(filePath));

    expect(codexRuntimePathEntries({
      env: { HOME: '/environment/home', PATH: '' },
      execFileSync: vi.fn(() => ''),
      existsSync,
      homedir: () => '/explicit/home',
      pathDelimiter: ':',
      platform: 'linux',
    })).toStrictEqual(['/explicit/home/.local/bin', '/usr/local/bin']);
  });

  it('uses an existing nvm command result and rejects a missing executable', () => {
    const execFileSync = vi.fn()
      .mockReturnValueOnce('')
      .mockReturnValueOnce(' /nvm/v22/bin/node \n');
    const existsSync = vi.fn((filePath: string) => filePath === '/nvm/v22/bin/node');
    const dependencies = {
      env: { PATH: '' }, execFileSync, existsSync, homedir: () => '/home/test',
      pathDelimiter: ':', platform: 'linux' as const,
    };

    expect(codexRuntimePathEntries(dependencies)).toContain('/nvm/v22/bin');
    existsSync.mockReturnValue(false);
    expect(codexRuntimePathEntries(dependencies)).not.toContain('/nvm/v22/bin');
  });

  it('requires complete nvm metadata and a nonempty alias before scanning versions', () => {
    const readFileSync = vi.fn(() => '22');
    const readdirSync = vi.fn(() => ['v22.1.0']);
    const base = {
      env: { PATH: '' },
      execFileSync: vi.fn(() => { throw new Error('no nvm command'); }),
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux' as const,
      readFileSync,
      readdirSync,
    };

    codexRuntimePathEntries({ ...base, existsSync: vi.fn(() => false) });
    codexRuntimePathEntries({
      ...base,
      existsSync: vi.fn((filePath: string) => filePath.endsWith('/.nvm/alias/default')),
    });

    expect(readFileSync).not.toHaveBeenCalled();
    expect(readdirSync).not.toHaveBeenCalled();

    const home = '/home/test';
    readFileSync.mockReturnValue('   \n');
    codexRuntimePathEntries({
      env: { PATH: '' },
      execFileSync: vi.fn(() => { throw new Error('no nvm command'); }),
      existsSync: vi.fn((filePath: string) => filePath.includes('/.nvm/')),
      homedir: () => home,
      pathDelimiter: ':',
      platform: 'linux',
      readFileSync,
      readdirSync,
    });

    expect(readFileSync).toHaveBeenCalledWith(`${home}/.nvm/alias/default`, 'utf8');
    expect(readdirSync).not.toHaveBeenCalled();
  });

  it('normalizes and selects the last matching nvm version independent of directory order', () => {
    const home = '/home/test';
    const existsSync = vi.fn((filePath: string) => [
      `${home}/.nvm/alias/default`, `${home}/.nvm/versions/node`,
    ].includes(filePath));

    expect(codexRuntimePathEntries({
      env: { PATH: '' },
      execFileSync: vi.fn(() => { throw new Error('no nvm command'); }),
      existsSync,
      homedir: () => home,
      pathDelimiter: ':',
      platform: 'linux',
      readFileSync: vi.fn(() => ' 22.10 \n'),
      readdirSync: vi.fn(() => ['v23.0.0', 'v22.10.2', 'v22.10.1']),
    })).toStrictEqual([`${home}/.nvm/versions/node/v22.10.2/bin`]);
  });

  it('returns no file-based nvm path when no version matches or directory reading fails', () => {
    const home = '/home/test';
    const existsSync = vi.fn((filePath: string) => filePath.includes('/.nvm/'));
    const base = {
      env: { PATH: '' },
      execFileSync: vi.fn(() => { throw new Error('no nvm command'); }),
      existsSync,
      homedir: () => home,
      pathDelimiter: ':',
      platform: 'linux' as const,
      readFileSync: vi.fn(() => '22'),
    };

    expect(codexRuntimePathEntries({ ...base, readdirSync: vi.fn(() => ['v20.1.0']) })).toStrictEqual([]);
    expect(codexRuntimePathEntries({
      ...base,
      readdirSync: vi.fn(() => { throw new Error('unreadable versions'); }),
    })).toStrictEqual([]);
  });

  it('normalizes Windows executable extensions from explicit and process environments', () => {
    let probes: string[] = [];
    expect(discoverCodexExecutable({
      env: { PATH: 'C:\\Tools', PATHEXT: '.EXE;;.CmD;' },
      existsSync: vi.fn((filePath: string) => {
        probes.push(filePath);
        return filePath.toLowerCase().endsWith('codex.cmd');
      }),
      pathDelimiter: ';',
      platform: 'win32',
    })).toMatch(/codex\.cmd$/i);
    expect(probes.map((entry) => entry.slice(entry.lastIndexOf('/') + 1))).toStrictEqual([
      'codex', 'codex.exe', 'codex.cmd',
    ]);

    vi.stubEnv('PATHEXT', '.Process;.CMD');
    probes = [];
    discoverCodexExecutable({
      env: { PATH: 'C:\\Tools' },
      existsSync: vi.fn((filePath: string) => {
        probes.push(filePath);
        return false;
      }),
      pathDelimiter: ';',
      platform: 'win32',
    });

    expect(probes.map((entry) => entry.slice(entry.lastIndexOf('/') + 1))).toStrictEqual([
      'codex', 'codex.process', 'codex.cmd',
    ]);

    vi.stubEnv('PATH', 'C:\\ProcessTools');
    vi.stubEnv('PATHEXT', '.EXE');

    expect(discoverCodexExecutable({
      existsSync: vi.fn((filePath: string) => filePath.toLowerCase().endsWith('codex.exe')),
      pathDelimiter: ';',
      platform: 'win32',
    })).toMatch(/codex\.exe$/i);
  });

  it('uses process HOME when neither an explicit resolver nor environment is supplied', () => {
    vi.stubEnv('HOME', '/process/home');
    const existsSync = vi.fn((filePath: string) => filePath === '/process/home/bin');

    expect(codexRuntimePathEntries({
      execFileSync: vi.fn(() => ''),
      existsSync,
      pathDelimiter: ':',
      platform: 'linux',
    })).toContain('/process/home/bin');
  });

  it('trims, removes blank path entries, and deduplicates across all discovery sources', () => {
    expect(codexRuntimePathEntries({
      env: { PATH: ' /one :: /two :/one ' },
      execFileSync: vi.fn()
        .mockReturnValueOnce('/two:/three::')
        .mockImplementationOnce(() => { throw new Error('no nvm'); }),
      existsSync: vi.fn(() => false),
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux',
    })).toStrictEqual(['/one', '/two', '/three']);
  });

  it('returns null after probing every executable candidate without a match', () => {
    const existsSync = vi.fn(() => false);
    expect(discoverCodexExecutable({
      env: { PATH: '/one:/two' },
      execFileSync: vi.fn(() => ''),
      existsSync,
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux',
    })).toBeNull();
    expect(existsSync).toHaveBeenCalledWith('/one/codex');
    expect(existsSync).toHaveBeenCalledWith('/two/codex');
  });

  it('probes only the unsuffixed executable outside Windows', () => {
    const probes: string[] = [];
    discoverCodexExecutable({
      env: { PATH: '/only' },
      execFileSync: vi.fn(() => ''),
      existsSync: vi.fn((filePath: string) => {
        if (filePath.startsWith('/only/')) probes.push(filePath);
        return false;
      }),
      homedir: () => '/home/test',
      pathDelimiter: ':',
      platform: 'linux',
    });

    expect(probes).toStrictEqual(['/only/codex']);
  });
});
