import { spawn } from 'node:child_process';
// tsc emits Nest's dependency-injection metadata; esbuild-only runners do not.
const compiler = spawn(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    '-p',
    'tsconfig.build.json',
    '--watch',
    '--preserveWatchOutput',
  ],
  { stdio: ['inherit', 'pipe', 'inherit'] },
);
let server;
compiler.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (!server && /Found 0 errors/.test(chunk.toString()))
    server = spawn(process.execPath, ['--watch', 'dist/src/main.js'], {
      stdio: 'inherit',
      env: { ...process.env },
    });
});
const stop = () => {
  server?.kill('SIGTERM');
  compiler.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
compiler.on('exit', (code) => {
  server?.kill('SIGTERM');
  process.exitCode = code ?? 1;
});
