import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distMain = path.join(sampleRoot, 'dist-main');
const probe = [
  "import { constants, accessSync, statSync } from 'node:fs';",
  "import { resolveAppleSpeechAnalyzerPath } from 'codex-app-sdk/node';",
  'const helper = resolveAppleSpeechAnalyzerPath();',
  'accessSync(helper, constants.R_OK | constants.X_OK);',
  "if (statSync(helper).size < 100_000) throw new Error('Apple speech helper is unexpectedly small');",
  'process.stdout.write(helper);',
].join('\n');
const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
  cwd: distMain,
  encoding: 'utf8',
});

if (result.status !== 0) {
  throw new Error(`Bundled sample could not resolve the SDK speech helper:\n${result.stderr || result.stdout}`);
}

const helperPath = result.stdout.trim();
if (!helperPath.endsWith(`${path.sep}assets${path.sep}apple-speechanalyzer-cli`)) {
  throw new Error(`Bundled sample resolved an unexpected speech helper: ${helperPath}`);
}

const preloadBundle = readFileSync(path.join(distMain, 'preload.cjs'), 'utf8');
for (const forbidden of ['node:child_process', 'node:fs', 'apple-speechanalyzer-cli', 'import.meta']) {
  if (preloadBundle.includes(forbidden)) {
    throw new Error(`Bundled preload leaked main-process code: ${forbidden}`);
  }
}

console.log(`verified bundled sample speech helper at ${helperPath}`);
