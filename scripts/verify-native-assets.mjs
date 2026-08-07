import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppleSpeechAnalyzerPath } from '../packages/backend/dist/index.js';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendRoot = path.join(packageRoot, 'packages/backend');
const packageJson = JSON.parse(await readFile(path.join(backendRoot, 'package.json'), 'utf8'));
if (!packageJson.files?.includes('assets')) {
  throw new Error('package.json must publish the SDK native assets directory');
}

const sourceAsset = path.join(backendRoot, 'assets/apple-speechanalyzer-cli');
const resolvedAsset = resolveAppleSpeechAnalyzerPath();
await access(sourceAsset);
await access(resolvedAsset);
const metadata = await stat(resolvedAsset);
if (!metadata.isFile() || metadata.size < 100_000) {
  throw new Error(`Apple speech helper is missing or unexpectedly small: ${resolvedAsset}`);
}
if ((metadata.mode & 0o111) === 0) {
  throw new Error(`Apple speech helper is not executable: ${resolvedAsset}`);
}

const magic = (await readFile(resolvedAsset)).subarray(0, 4).toString('hex');
if (magic !== 'cafebabe') {
  throw new Error(`Apple speech helper is not the expected universal Mach-O binary: ${magic}`);
}

console.log(`verified packaged Apple speech helper at ${path.relative(packageRoot, resolvedAsset)}`);
