import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const rootManifest = await readManifest('package.json');
const packageDirectories = (await readdir(path.join(repositoryRoot, 'packages'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const packages = (await Promise.all(packageDirectories.map(async (directory) => ({
  directory,
  manifest: await readManifest(path.join('packages', directory, 'package.json')),
})))).filter(({ manifest }) => manifest.private !== true);
const publishedNames = new Set(packages.map(({ manifest }) => manifest.name));
const errors = [];

for (const { directory, manifest } of packages) {
  const expectedName = `@codex-app-sdk/${directory}`;
  if (manifest.name !== expectedName) {
    errors.push(`${directory}: expected package name ${expectedName}, received ${manifest.name}`);
  }
  if (manifest.version !== rootManifest.version) {
    errors.push(`${manifest.name}: expected version ${rootManifest.version}, received ${manifest.version}`);
  }
  if (manifest.publishConfig?.registry !== 'https://npm.pkg.github.com'
    || manifest.publishConfig?.access !== 'restricted') {
    errors.push(`${manifest.name}: expected restricted GitHub Packages publication`);
  }
  for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
    if (publishedNames.has(dependency) && version !== rootManifest.version) {
      errors.push(`${manifest.name}: expected ${dependency}@${rootManifest.version}, received ${version}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`verified ${packages.length} release packages at ${rootManifest.version}`);

if (process.argv.includes('--check')) {
  process.exit(0);
}

for (const { manifest } of packages) {
  const result = spawnSync('npm', ['publish', '--workspace', manifest.name], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function readManifest(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
}
