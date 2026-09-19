import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const vitestEntry = join(repositoryRoot, 'node_modules/vitest/vitest.mjs');
const suites = [
  { name: '@codex-app-sdk/core', directory: 'packages/core', runner: 'vitest' },
  { name: '@codex-app-sdk/backend', directory: 'packages/backend', runner: 'vitest' },
  { name: '@codex-app-sdk/vue', directory: 'packages/vue', runner: 'vitest' },
  { name: '@codex-app-sdk/electron', directory: 'packages/electron', runner: 'vitest' },
  { name: '@codex-app-sdk/web', directory: 'packages/web', runner: 'vitest' },
  { name: '@codex-app-sdk/create-codex-app', directory: 'packages/create-codex-app', runner: 'node' },
  { name: 'component lab', directory: 'samples/component-lab', runner: 'vitest' },
  { name: 'basic Electron sample', directory: 'samples/electron/basic', runner: 'vitest' },
  { name: 'Spark sample', directory: 'samples/electron/spark', runner: 'vitest' },
  { name: 'Relay sample', directory: 'samples/electron/relay', runner: 'vitest' },
].map((suite) => ({ ...suite, root: resolve(repositoryRoot, suite.directory) }));

const requestedArguments = process.argv.slice(2);
const requestedPaths = requestedArguments
  .filter((argument) => !argument.startsWith('-'))
  .map((argument) => resolve(repositoryRoot, argument))
  .filter(existsSync);
const otherArguments = requestedArguments.filter(
  (argument) => argument.startsWith('-') || !existsSync(resolve(repositoryRoot, argument)),
);

const pathsBySuite = new Map();
for (const requestedPath of requestedPaths) {
  const owner = suites
    .filter((suite) => isInside(suite.root, requestedPath))
    .sort((left, right) => right.root.length - left.root.length)[0];
  if (!owner) continue;
  const paths = pathsBySuite.get(owner) ?? [];
  paths.push(relative(owner.root, requestedPath));
  pathsBySuite.set(owner, paths);
}

let exitCode = 0;
for (const suite of suites) {
  if (requestedPaths.length > 0 && !pathsBySuite.has(suite)) continue;

  console.log(`\n[TESTS] ${suite.name}`);
  const requestedSuitePaths = pathsBySuite.get(suite);
  const argumentsForSuite = suite.runner === 'vitest'
    ? [
        vitestEntry,
        'run',
        '--silent=true',
        '--reporter=agent',
        ...otherArguments,
        ...(requestedSuitePaths ?? []),
      ]
    : [
        '--test',
        '--test-reporter=dot',
        ...otherArguments,
        ...(requestedSuitePaths ?? nodeTestFiles(suite.root)),
      ];
  const result = spawnSync(process.execPath, argumentsForSuite, {
    cwd: suite.root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error);
    exitCode = 1;
    break;
  }
  if (result.status !== 0) {
    exitCode = result.status ?? 1;
    break;
  }
}

console.log('\n[TESTS:DONE]');
process.exitCode = exitCode;

function isInside(directory, candidate) {
  const candidateRelativePath = relative(directory, candidate);
  return candidateRelativePath === ''
    || (!candidateRelativePath.startsWith('..') && !isAbsolute(candidateRelativePath));
}

function nodeTestFiles(directory) {
  return readdirSync(join(directory, 'tests'))
    .filter((file) => file.endsWith('.test.mjs'))
    .map((file) => join('tests', file));
}
