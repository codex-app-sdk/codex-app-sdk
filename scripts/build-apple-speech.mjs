import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Build the Apple speech helper on macOS with Xcode 26 or later.');
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'sdk-speech-build-'));
try {
  const slices = ['arm64', 'x86_64'].map((arch) => {
    const output = path.join(temp, arch);
    execFileSync('xcrun', ['swiftc', '-parse-as-library', '-O', '-target', `${arch}-apple-macos26.0`,
      path.join(root, 'packages/backend/native/apple-speech.swift'), '-o', output], { stdio: 'inherit' });
    return output;
  });
  const output = path.join(root, 'packages/backend/assets/apple-speechanalyzer-cli');
  execFileSync('xcrun', ['lipo', '-create', ...slices, '-output', output]);
  execFileSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' });
} finally { rmSync(temp, { recursive: true, force: true }); }
