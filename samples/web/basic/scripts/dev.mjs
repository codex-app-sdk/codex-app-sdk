import { spawn } from 'node:child_process';

const children = [
  spawn('vite', [], { stdio: 'inherit' }),
  spawn('tsx', ['watch', '--clear-screen=false', '--tsconfig', 'tsconfig.dev-server.json', 'src/server/index.ts'], {
    stdio: 'inherit',
  }),
];

let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stop(signal));
}

for (const child of children) {
  child.once('error', (error) => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      stop();
      process.exitCode = signal ? 1 : (code ?? 1);
    }
  });
}
