import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = join(packageRoot, 'template');
const packageMetadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const packageManagers = new Set(['npm', 'pnpm', 'yarn', 'bun']);

export async function run(
  argv = process.argv.slice(2),
  options = {},
) {
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  try {
    const parsed = parseArguments(argv);
    if (parsed.help) {
      output.write(helpText());
      return;
    }
    if (parsed.version) {
      output.write(`${packageMetadata.version}\n`);
      return;
    }

    const directory = parsed.directory ?? await (options.promptForDirectory ?? promptForDirectory)();
    const packageManager = parsed.packageManager ?? packageManagerFromUserAgent(process.env.npm_config_user_agent);
    const project = await scaffoldProject({
      cwd: options.cwd,
      directory,
      templateDirectory: options.templateDirectory,
    });

    if (parsed.install) {
      await (options.installDependencies ?? installDependencies)(project.path, packageManager);
    }
    output.write(successMessage(project, packageManager, parsed.install, options.cwd));
  } catch (error) {
    errorOutput.write(`create-codex-app: ${error instanceof Error ? error.message : String(error)}\n`);
    if (options.throwOnError) throw error;
    process.exitCode = 1;
  }
}

export function parseArguments(argv) {
  let directory;
  let packageManager;
  let install = true;
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--version' || argument === '-v') {
      version = true;
      continue;
    }
    if (argument === '--no-install') {
      install = false;
      continue;
    }
    if (argument === '--package-manager') {
      packageManager = argv[index + 1];
      index += 1;
      validatePackageManager(packageManager);
      continue;
    }
    if (argument.startsWith('--package-manager=')) {
      packageManager = argument.slice('--package-manager='.length);
      validatePackageManager(packageManager);
      continue;
    }
    if (argument.startsWith('-')) throw new Error(`Unknown option '${argument}'`);
    if (directory) throw new Error('Only one project directory may be provided');
    directory = argument;
  }

  return { directory, help, install, packageManager, version };
}

export async function scaffoldProject({ cwd = process.cwd(), directory, templateDirectory = templateRoot }) {
  const requestedDirectory = directory.trim();
  if (!requestedDirectory) throw new Error('Project directory cannot be empty');
  const target = resolve(cwd, requestedDirectory);
  const directoryName = basename(target);
  const project = {
    displayName: displayNameForDirectory(directoryName),
    packageName: packageNameForDirectory(directoryName),
    path: target,
  };
  await assertEmptyTarget(target);
  await mkdir(target, { recursive: true });
  await cp(templateDirectory, target, { recursive: true });

  const gitignore = join(target, '_gitignore');
  await rename(gitignore, join(target, '.gitignore'));

  await replaceTemplateTokens(target, project);
  return project;
}

export function packageManagerFromUserAgent(userAgent) {
  const candidate = userAgent?.split(' ')[0]?.split('/')[0];
  return packageManagers.has(candidate) ? candidate : 'npm';
}

function validatePackageManager(value) {
  if (!packageManagers.has(value)) {
    throw new Error(`Unsupported package manager '${value ?? ''}'. Use npm, pnpm, yarn, or bun.`);
  }
}

async function assertEmptyTarget(target) {
  try {
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) throw new Error(`Target '${target}' is not a directory`);
    if ((await readdir(target)).length > 0) throw new Error(`Target directory '${target}' is not empty`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

async function replaceTemplateTokens(directory, project) {
  for (const path of await filesBelow(directory)) {
    const source = await readFile(path, 'utf8');
    const rendered = source
      .replaceAll('{{packageName}}', project.packageName)
      .replaceAll('{{displayName}}', project.displayName);
    await writeFile(path, rendered);
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function packageNameForDirectory(directoryName) {
  const packageName = directoryName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!packageName || !/^[a-z0-9]/.test(packageName)) {
    throw new Error(`Cannot derive a package name from '${directoryName}'`);
  }
  return packageName;
}

function displayNameForDirectory(directoryName) {
  const name = directoryName.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  return name
    ? name.split(' ').map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ')
    : 'Codex App';
}

async function promptForDirectory() {
  if (!process.stdin.isTTY) throw new Error('Provide a project directory');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question('Project directory: ');
  } finally {
    prompt.close();
  }
}

async function installDependencies(directory, packageManager) {
  const executable = process.platform === 'win32' ? `${packageManager}.cmd` : packageManager;
  const args = packageManager === 'yarn' ? [] : ['install'];
  await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: directory, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${packageManager} install failed${signal ? ` with signal ${signal}` : ` with code ${code}`}`));
    });
  });
}

function successMessage(project, packageManager, installed, cwd = process.cwd()) {
  const displayPath = relative(resolve(cwd), project.path) || '.';
  const shellPath = /\s/.test(displayPath) ? JSON.stringify(displayPath) : displayPath;
  const enterDirectory = displayPath === '.' ? '' : `  cd ${shellPath}\n`;
  const install = installed ? '' : `  ${packageManager} install\n`;
  return `\nCreated ${project.displayName} in ${project.path}\n\n${enterDirectory}${install}  ${packageManager} run dev\n\n`;
}

function helpText() {
  return `create-codex-app ${packageMetadata.version}\n\nUsage:\n  create-codex-app [directory] [options]\n\nOptions:\n  --no-install                   Skip dependency installation\n  --package-manager <manager>    npm, pnpm, yarn, or bun\n  -h, --help                     Show this help\n  -v, --version                  Show the version\n`;
}
