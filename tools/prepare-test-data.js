#!/usr/bin/env node
/**
 * Create an isolated data directory for Playwright. The committed data/ files
 * are copied, never mutated, so a test run cannot change the audited numbers
 * in results/results.md.
 */

import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('data');
const target = path.resolve('.playwright-data');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

for (const name of ['experiments.json', 'events.json']) {
  const from = path.join(source, name);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(target, name));
  } else {
    fs.writeFileSync(path.join(target, name), '[]\n');
  }
}

console.log(`Playwright isolated data ready at ${target}`);
