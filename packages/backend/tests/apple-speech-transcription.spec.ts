import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveAppleSpeechAnalyzerPath,
  transcribeWithAppleSpeechAnalyzer,
} from '../src/node/apple-speech-transcription';

describe('transcribeWithAppleSpeechAnalyzer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves the default helper path without relying on a URL value', () => {
    expect(resolveAppleSpeechAnalyzerPath()).toMatch(/apple-speechanalyzer-cli$/);
  });

  it('writes audio, invokes the Apple speech CLI, reads text, and cleans up', async () => {
    const fs = fakeFs('ship the feature\n');
    const spawn = fakeSpawn(0);

    const result = await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), { locale: 'en-US' }, {
      assetsPath: '/app/assets',
      fs,
      spawn,
      tmpdir: () => '/tmp',
    });

    expect(result).toStrictEqual({ text: 'ship the feature' });
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123/input.wav', Buffer.from('audio'));
    expect(fs.copyFile).toHaveBeenCalledWith(
      '/app/assets/apple-speechanalyzer-cli',
      '/tmp/codex-app-sdk-apple-stt-123/apple-speechanalyzer-cli',
    );
    expect(fs.chmod).toHaveBeenCalledWith(
      '/tmp/codex-app-sdk-apple-stt-123/apple-speechanalyzer-cli',
      0o700,
    );
    expect(spawn).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123/apple-speechanalyzer-cli', [
      '--input-audio-path',
      '/tmp/codex-app-sdk-apple-stt-123/input.wav',
      '--output-txt-path',
      '/tmp/codex-app-sdk-apple-stt-123/output.txt',
      '--locale',
      'en-US',
    ]);
    expect(fs.rm).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123', { recursive: true, force: true });
    expect(fs.readFile).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123/output.txt', 'utf8');
  });

  it('trims locale and enables live transcription in the exact CLI arguments', async () => {
    const fs = fakeFs('live result');
    const spawn = fakeSpawn(0);

    await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), {
      locale: '  fr-FR  ',
      live: true,
    }, {
      assetsPath: '/app/assets',
      fs,
      spawn,
      tmpdir: () => '/tmp',
    });

    expect(spawn).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123/apple-speechanalyzer-cli', [
      '--input-audio-path',
      '/tmp/codex-app-sdk-apple-stt-123/input.wav',
      '--output-txt-path',
      '/tmp/codex-app-sdk-apple-stt-123/output.txt',
      '--locale',
      'fr-FR',
      '--live',
    ]);
  });

  it('omits a blank locale and disabled live flag from the CLI arguments', async () => {
    const fs = fakeFs('plain result');
    const spawn = fakeSpawn(0);

    await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), {
      locale: '   ',
      live: false,
    }, {
      assetsPath: '/app/assets',
      fs,
      spawn,
      tmpdir: () => '/tmp',
    });

    expect(spawn).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123/apple-speechanalyzer-cli', [
      '--input-audio-path',
      '/tmp/codex-app-sdk-apple-stt-123/input.wav',
      '--output-txt-path',
      '/tmp/codex-app-sdk-apple-stt-123/output.txt',
    ]);
  });

  it('returns a renderer-safe error when the CLI fails', async () => {
    const fs = fakeFs('');
    const spawn = fakeSpawn(2, 'permission denied\n');

    const result = await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), {}, {
      assetsPath: '/app/assets',
      fs,
      spawn,
      tmpdir: () => '/tmp',
    });

    expect(result).toStrictEqual({
      text: '',
      error: 'Apple speech CLI exited with code 2: permission denied',
    });
    expect(fs.rm).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123', { recursive: true, force: true });
  });

  it('returns a renderer-safe error when spawning the CLI fails', async () => {
    const fs = fakeFs('');
    const spawn = fakeSpawnError(new Error('operation not permitted'));

    const result = await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), {}, {
      assetsPath: '/app/assets',
      fs,
      spawn,
      tmpdir: () => '/tmp',
    });

    expect(result).toStrictEqual({
      text: '',
      error: 'Failed to spawn Apple speech CLI: operation not permitted',
    });
    expect(fs.rm).toHaveBeenCalledWith('/tmp/codex-app-sdk-apple-stt-123', { recursive: true, force: true });
  });

  it('handles a CLI without a stderr stream', async () => {
    const fs = fakeFs('');
    const spawn = fakeSpawn(9, undefined, false);

    const result = await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), {}, {
      assetsPath: '/app/assets',
      fs,
      spawn,
      tmpdir: () => '/tmp',
    });

    expect(result).toStrictEqual({
      text: '',
      error: 'Apple speech CLI exited with code 9: ',
    });
  });

  it('normalizes non-Error failures for renderer transport', async () => {
    const fs = fakeFs('');
    fs.writeFile.mockRejectedValueOnce('disk unavailable');

    const result = await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), {}, {
      assetsPath: '/app/assets',
      fs,
      spawn: fakeSpawn(0),
      tmpdir: () => '/tmp',
    });

    expect(result).toStrictEqual({ text: '', error: 'disk unavailable' });
  });

  it('uses the backend assets path environment when no per-call override is provided', async () => {
    vi.stubEnv('CODEX_APP_SDK_ASSETS_PATH', '  /configured/assets  ');
    const fs = fakeFs('from env\n');
    const spawn = fakeSpawn(0);

    const result = await transcribeWithAppleSpeechAnalyzer(Buffer.from('audio'), {}, {
      fs,
      spawn,
      tmpdir: () => '/tmp',
    });

    expect(result).toStrictEqual({ text: 'from env' });
    expect(fs.copyFile).toHaveBeenCalledWith(
      '/configured/assets/apple-speechanalyzer-cli',
      '/tmp/codex-app-sdk-apple-stt-123/apple-speechanalyzer-cli',
    );
    expect(spawn).toHaveBeenCalledWith(
      '/tmp/codex-app-sdk-apple-stt-123/apple-speechanalyzer-cli',
      expect.any(Array),
    );
  });

  it('ignores a blank backend assets path environment value', () => {
    vi.stubEnv('CODEX_APP_SDK_ASSETS_PATH', '   ');

    expect(resolveAppleSpeechAnalyzerPath()).not.toBe('   /apple-speechanalyzer-cli');
  });

  it.each([
    '',
    'assets',
    'app.asar.unpacked/node_modules/@codex-app-sdk/backend/assets',
    'app.asar/node_modules/@codex-app-sdk/backend/assets',
    'app.asar.unpacked/node_modules/codex-app-sdk/assets',
    'app.asar/node_modules/codex-app-sdk/assets',
  ])('finds the packaged helper in the resources candidate %j', async (relativeCandidate) => {
    const resourcesPath = '/bundle/resources';
    const candidate = path.join(resourcesPath, relativeCandidate);
    const expectedPath = path.join(candidate, 'apple-speechanalyzer-cli');

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === expectedPath,
      { resourcesPath },
    ))).toBe(expectedPath);
  });

  it('skips a Vite build resources directory', async () => {
    const resourcesPath = '/bundle/.vite/build';
    const packagedPath = path.join(resourcesPath, 'apple-speechanalyzer-cli');

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === packagedPath,
      { resourcesPath },
    ))).not.toBe(packagedPath);
  });

  it('continues discovery when a resources directory has no helper', () => {
    const packagePath = '/installed/sdk/assets/apple-speechanalyzer-cli';

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === packagePath,
      {
        packageResolve: () => 'file:///installed/sdk/dist/index.js',
        resourcesPath: '/bundle/resources',
      },
    ))).toBe(packagePath);
  });

  it('uses the process resources path when no dependency override is provided', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    const expectedPath = '/process/resources/apple-speechanalyzer-cli';
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/process/resources',
    });

    try {
      expect(resolveAppleSpeechAnalyzerPath(undefined, {
        ...discoveryDependencies((filePath) => filePath === expectedPath),
        resourcesPath: undefined,
      })).toBe(expectedPath);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process, 'resourcesPath', originalDescriptor);
      } else {
        Reflect.deleteProperty(process, 'resourcesPath');
      }
    }
  });

  it('uses the installed package assets when package resolution finds the helper', async () => {
    const packagePath = '/installed/sdk/assets/apple-speechanalyzer-cli';

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === packagePath,
      {
        packageResolve: (specifier) => {
          if (specifier !== '@codex-app-sdk/backend') throw new Error('unexpected package');
          return 'file:///installed/sdk/dist/index.js';
        },
      },
    ))).toBe(packagePath);
  });

  it('uses the runtime package resolver when no dependency override is provided', () => {
    const packagePath = path.resolve(import.meta.dirname, '../assets/apple-speechanalyzer-cli');

    expect(resolveAppleSpeechAnalyzerPath(undefined, {
      ...discoveryDependencies((filePath) => filePath === packagePath),
      moduleUrl: 'file:///unrelated/module/dist/index.js',
      packageResolve: undefined,
    })).toBe(packagePath);
  });

  it('continues discovery when the resolved package has no helper', () => {
    const cwdPath = '/workspace/application/node_modules/@codex-app-sdk/backend/assets/apple-speechanalyzer-cli';

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === cwdPath,
      { packageResolve: () => 'file:///installed/sdk/dist/index.js' },
    ))).toBe(cwdPath);
  });

  it('falls through when package resolution fails', () => {
    const cwdPath = '/workspace/application/node_modules/@codex-app-sdk/backend/assets/apple-speechanalyzer-cli';

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === cwdPath,
      {
        packageResolve: () => {
          throw new Error('package is unavailable');
        },
      },
    ))).toBe(cwdPath);
  });

  it.each([
    'node_modules/@codex-app-sdk/backend/assets',
    '../node_modules/@codex-app-sdk/backend/assets',
    'node_modules/codex-app-sdk/assets',
    '../node_modules/codex-app-sdk/assets',
    '../codex-app-sdk/assets',
  ])('finds the helper from the cwd candidate %j', async (relativeCandidate) => {
    const candidate = path.resolve('/workspace/application', relativeCandidate);
    const expectedPath = path.join(candidate, 'apple-speechanalyzer-cli');

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === expectedPath,
    ))).toBe(expectedPath);
  });

  it.each([
    '/installed/sdk/assets',
    '/installed/assets',
  ])('finds the helper from the module-relative candidate %j', (candidate) => {
    const expectedPath = path.join(candidate, 'apple-speechanalyzer-cli');

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === expectedPath,
      { moduleUrl: 'file:///installed/sdk/dist/index.js' },
    ))).toBe(expectedPath);
  });

  it('uses cwd for module-relative fallback when no module URL is available', () => {
    const expectedPath = '/workspace/assets/apple-speechanalyzer-cli';

    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      (filePath) => filePath === expectedPath,
      { moduleUrl: null },
    ))).toBe(expectedPath);
  });

  it('uses the runtime module URL when no dependency override is provided', () => {
    const expectedPath = path.resolve(import.meta.dirname, '../src/assets/apple-speechanalyzer-cli');

    expect(resolveAppleSpeechAnalyzerPath(undefined, {
      ...discoveryDependencies((filePath) => filePath === expectedPath),
      moduleUrl: undefined,
    })).toBe(expectedPath);
  });

  it('falls back to the first module-relative assets directory when no helper exists', () => {
    expect(resolveAppleSpeechAnalyzerPath(undefined, discoveryDependencies(
      () => false,
      { moduleUrl: 'file:///installed/sdk/dist/index.js' },
    ))).toBe('/installed/sdk/assets/apple-speechanalyzer-cli');
  });
});

function discoveryDependencies(
  existsSync: (filePath: string) => boolean,
  overrides: Partial<NonNullable<Parameters<typeof resolveAppleSpeechAnalyzerPath>[1]>> = {},
): NonNullable<Parameters<typeof resolveAppleSpeechAnalyzerPath>[1]> {
  return {
    cwd: () => '/workspace/application',
    env: {},
    existsSync,
    moduleUrl: 'file:///workspace/sdk/src/node/apple-speech-transcription.js',
    packageResolve: null,
    resourcesPath: null,
    ...overrides,
  };
}

function fakeFs(output: string) {
  return {
    chmod: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}123`),
    readFile: vi.fn(async (filePath: string) => {
      expect(path.basename(filePath)).toBe('output.txt');
      return output;
    }),
    rm: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
}

function fakeSpawn(code: number, stderr: string | undefined = '', includeStderr = true) {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stderr?: EventEmitter };
    if (includeStderr) child.stderr = new EventEmitter();

    queueMicrotask(() => {
      if (stderr && child.stderr) {
        child.stderr.emit('data', Buffer.from(stderr));
      }
      child.emit('exit', code);
    });

    return child;
  });
}

function fakeSpawnError(error: Error) {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('error', error));
    return child;
  });
}
