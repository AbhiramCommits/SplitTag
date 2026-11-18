#!/usr/bin/env node
/**
 * One-command reproducible demo: reset data from seeds, boot the server, run
 * both seeded simulations through the real API, then regenerate the results
 * report and stop the server.
 *
 * Usage: npm run demo
 *        PORT=4010 npm run demo
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetData } from './reset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = process.env.PORT || '4000';
const baseUrl = `http://127.0.0.1:${port}`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal || code}`));
    });
  });
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      if (response.ok) return;
    } catch (err) { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${baseUrl}`);
}

console.log('SplitTag demo');
console.log('=============');
console.log('');
resetData();

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: port }
});

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  server.kill('SIGTERM');
}

process.on('SIGINT', () => { stopServer(); process.exit(130); });
process.on('SIGTERM', () => { stopServer(); process.exit(143); });

try {
  await waitForServer();
  console.log(`Server ready at ${baseUrl}`);
  console.log('');
  console.log('Simulating exp-hero-cta…');
  await run(process.execPath, [
    'tools/simulate.js',
    '--experiment', 'exp-hero-cta',
    '--visitors', '8000',
    '--control-rate', '0.082',
    '--variant-rate', '0.101',
    '--seed', '42',
    '--url', baseUrl
  ]);
  console.log('Simulating exp-form-position…');
  await run(process.execPath, [
    'tools/simulate.js',
    '--experiment', 'exp-form-position',
    '--visitors', '8000',
    '--control-rate', '0.112',
    '--variant-rate', '0.094',
    '--seed', '42',
    '--url', baseUrl
  ]);
  console.log('Regenerating results/…');
  await run(process.execPath, ['tools/report.js', '--url', baseUrl]);
  console.log('Demo complete. Results are in results/results.md and results/results.json.');
} catch (err) {
  console.error(`Demo failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  stopServer();
}
