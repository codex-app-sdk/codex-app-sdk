import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as nodeFs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

export type AppleSpeechTranscriptionOptions = {
  locale?: string;
  live?: boolean;
};

export type AppleSpeechTranscriptionResult = {
  text: string;
  error?: string;
};

type AppleSpeechFs = {
  chmod(filePath: string, mode: number): Promise<void>;
  copyFile(sourcePath: string, destinationPath: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  rm(filePath: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  writeFile(filePath: string, data: Buffer): Promise<void>;
};

type AppleSpeechChild = {
  stderr?: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  };
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
};

type AppleSpeechSpawn = (command: string, args: string[]) => AppleSpeechChild;

type AppleSpeechTranscriptionDeps = {
  assetsPath?: string;
  fs?: AppleSpeechFs;
  spawn?: AppleSpeechSpawn;
  tmpdir?: () => string;
};

export async function transcribeWithAppleSpeechAnalyzer(
  audioData: Buffer,
  options: AppleSpeechTranscriptionOptions = {},
  deps: AppleSpeechTranscriptionDeps = {},
): Promise<AppleSpeechTranscriptionResult> {
  const fs = deps.fs ?? nodeFs;
  const spawn = deps.spawn ?? nodeSpawn;
  const tmpdir = deps.tmpdir ?? os.tmpdir;
  const bundledCliPath = resolveAppleSpeechAnalyzerPath(deps.assetsPath);
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'codex-app-sdk-apple-stt-'));
  const inputPath = path.join(tempDir, 'input.wav');
  const outputPath = path.join(tempDir, 'output.txt');

  try {
    const cliPath = await executableAppleSpeechPath(bundledCliPath, tempDir, fs);
    await fs.writeFile(inputPath, audioData);
    await runAppleSpeechCli(spawn, cliPath, buildAppleSpeechArgs(inputPath, outputPath, options));
    const text = await fs.readFile(outputPath, 'utf8');

    return { text: text.trim() };
  } catch (error) {
    return {
      text: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export function resolveAppleSpeechAnalyzerPath(assetsPath?: string): string {
  return path.join(assetsPath ?? defaultAssetsPath(), 'apple-speechanalyzer-cli');
}

function buildAppleSpeechArgs(
  inputPath: string,
  outputPath: string,
  options: AppleSpeechTranscriptionOptions,
): string[] {
  const args = [
    '--input-audio-path',
    inputPath,
    '--output-txt-path',
    outputPath,
  ];

  const locale = options.locale?.trim();
  if (locale) {
    args.push('--locale', locale);
  }

  if (options.live) {
    args.push('--live');
  }

  return args;
}

function runAppleSpeechCli(
  spawn: AppleSpeechSpawn,
  cliPath: string,
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args);
    let stderr = '';

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: Error) => {
      reject(new Error(`Failed to spawn Apple speech CLI: ${error.message}`));
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Apple speech CLI exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function defaultAssetsPath(): string {
  const configuredAssetsPath = process.env.CODEX_APP_SDK_ASSETS_PATH?.trim();
  if (configuredAssetsPath) {
    return configuredAssetsPath;
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath && !resourcesPath.endsWith('.vite/build')) {
    const resourceCandidates = [
      resourcesPath,
      path.join(resourcesPath, 'assets'),
      path.join(resourcesPath, 'app.asar.unpacked/node_modules/codex-app-sdk/assets'),
      path.join(resourcesPath, 'app.asar/node_modules/codex-app-sdk/assets'),
    ];
    const match = resourceCandidates.find((candidate) => (
      existsSync(path.join(candidate, 'apple-speechanalyzer-cli'))
    ));
    if (match) return match;
  }

  try {
    const packageNodeEntry = fileURLToPath(import.meta.resolve('codex-app-sdk/node'));
    const packageAssetsPath = path.resolve(path.dirname(packageNodeEntry), '../assets');
    if (existsSync(path.join(packageAssetsPath, 'apple-speechanalyzer-cli'))) {
      return packageAssetsPath;
    }
  } catch {
    // Source checkouts fall through to module-relative candidates.
  }

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const moduleCandidates = [
    path.resolve(moduleDirectory, '../assets'),
    path.resolve(moduleDirectory, '../../assets'),
  ];
  return moduleCandidates.find((candidate) => (
    existsSync(path.join(candidate, 'apple-speechanalyzer-cli'))
  )) ?? moduleCandidates[0]!;
}

async function executableAppleSpeechPath(
  sourcePath: string,
  tempDir: string,
  fs: AppleSpeechFs,
): Promise<string> {
  const executablePath = path.join(tempDir, 'apple-speechanalyzer-cli');
  await fs.copyFile(sourcePath, executablePath);
  await fs.chmod(executablePath, 0o700);
  return executablePath;
}
