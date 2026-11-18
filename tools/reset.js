#!/usr/bin/env node
/**
 * Restore data/ from seeds/: experiments come from seeds/*.json and the event
 * log is cleared. Run `node tools/report.js` afterwards to regenerate results.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { replaceExperiments, replaceEvents } from '../server/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/**
 * Replace the data directory contents with the committed seed experiments and
 * an empty event log.
 * @param {{quiet?: boolean}} [options]
 * @returns {{experiments: number, events: number}}
 */
export function resetData(options = {}) {
  const seedsDir = path.join(root, 'seeds');
  const files = fs.readdirSync(seedsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const experiments = files
    .map((file) => JSON.parse(fs.readFileSync(path.join(seedsDir, file), 'utf8')))
    .sort((a, b) => a.name.localeCompare(b.name));
  replaceExperiments(experiments);
  replaceEvents([]);
  if (!options.quiet) {
    console.log(`Reset data/ from seeds/: ${experiments.length} experiments, 0 events.`);
    for (const experiment of experiments) console.log(`  ${experiment.id} (${experiment.status})`);
  }
  return { experiments: experiments.length, events: 0 };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) resetData();
