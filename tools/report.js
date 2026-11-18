#!/usr/bin/env node
/**
 * Fetch /api/results for every experiment and write results/results.md and
 * results/results.json. Numbers are not recomputed here: the report mirrors
 * exactly what the API returned.
 *
 * Usage: node tools/report.js [--url http://localhost:4000]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const baseUrl = (urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4000').replace(/\/$/, '');

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function signedPct(value) {
  const number = Number(value || 0) * 100;
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function pValue(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 0.0001) return '<0.0001';
  return value.toFixed(4);
}

function num(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function markdown(results) {
  const lines = [];
  lines.push('# SplitTag experiment results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('These numbers are generated from the committed event log through the live stats engine');
  lines.push('(`GET /api/results/:id`). Regenerate with `node tools/report.js`.');
  lines.push('');

  for (const result of results) {
    const control = result.variants.find((variant) => variant.isControl) || result.variants[0];
    const treatment = result.variants.find((variant) => !variant.isControl);
    lines.push(`## ${result.experiment.name} (\`${result.experiment.id}\`)`);
    lines.push('');
    lines.push(`**Decision: ${result.decision}**`);
    lines.push('');
    lines.push(result.reason);
    lines.push('');
    lines.push('| Variant | Visitors | Conversions | Conversion rate | Lift vs control | 95% CI (lift) | p-value |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const variant of result.variants) {
      const ci = variant.liftCI95 && !variant.isControl
        ? `${signedPct(variant.liftCI95[0])} to ${signedPct(variant.liftCI95[1])}`
        : '—';
      lines.push(`| ${variant.name}${variant.isControl ? ' (control)' : ''} | ${num(variant.visitors)} | ${num(variant.conversions)} | ${pct(variant.conversionRate)} | ${variant.isControl ? '—' : signedPct(variant.lift)} | ${ci} | ${variant.isControl ? '—' : pValue(variant.pValue)} |`);
    }
    lines.push('');
    lines.push(`- Control conversion rate: **${pct(control.conversionRate)}** (${num(control.conversions)}/${num(control.visitors)})`);
    if (treatment) {
      lines.push(`- Variant conversion rate: **${pct(treatment.conversionRate)}** (${num(treatment.conversions)}/${num(treatment.visitors)})`);
      lines.push(`- Absolute lift: **${signedPct(treatment.conversionRate - control.conversionRate)}**; relative lift: **${signedPct(treatment.lift)}**`);
      lines.push(`- 95% CI for relative lift: **${signedPct(treatment.liftCI95[0])} to ${signedPct(treatment.liftCI95[1])}**`);
      lines.push(`- Two-tailed p-value: **${pValue(treatment.pValue)}**; z = ${Number(treatment.zScore).toFixed(4)}`);
    }
    lines.push(`- Required sample: **${Number.isFinite(result.requiredSampleSize) ? num(result.requiredSampleSize) : 'not available'} per arm** at α=${result.alpha}, power=${result.power}, MDE=${pct(result.minimumDetectableEffect)}`);
    lines.push(`- Sample progress: **${(result.sampleProgress * 100).toFixed(1)}%** of the planned per-arm sample`);
    lines.push(`- Exposed visitors total: **${num(result.totalVisitors)}**`);
    lines.push('');
    if (result.goals && result.goals.length > 0) {
      lines.push('### Goals');
      lines.push('');
      lines.push('| Goal | Type | Control conversions | Variant conversions |');
      lines.push('| --- | --- | ---: | ---: |');
      for (const goal of result.goals) {
        const c = goal.variants.find((variant) => variant.variantId === control.id);
        const v = treatment ? goal.variants.find((variant) => variant.variantId === treatment.id) : null;
        lines.push(`| ${goal.name} | ${goal.type} | ${c ? `${num(c.conversions)} (${pct(c.conversionRate)})` : '—'} | ${v ? `${num(v.conversions)} (${pct(v.conversionRate)})` : '—'} |`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

let experiments;
try {
  const response = await fetch(`${baseUrl}/api/experiments`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  experiments = await response.json();
} catch (err) {
  console.error(`Could not load experiments from ${baseUrl}: ${err.message}`);
  console.error('Start the server first with: npm start');
  process.exit(1);
}

const results = [];
for (const experiment of experiments) {
  const response = await fetch(`${baseUrl}/api/results/${encodeURIComponent(experiment.id)}`);
  if (!response.ok) {
    console.error(`Could not load results for ${experiment.id}: HTTP ${response.status}`);
    process.exit(1);
  }
  results.push(await response.json());
}

await fs.mkdir(path.join(root, 'results'), { recursive: true });
await fs.writeFile(path.join(root, 'results', 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(root, 'results', 'results.md'), markdown(results), 'utf8');

for (const result of results) {
  const control = result.variants.find((variant) => variant.isControl) || result.variants[0];
  const treatment = result.variants.find((variant) => !variant.isControl);
  console.log(`\n${result.experiment.name} (${result.experiment.id})`);
  for (const variant of result.variants) {
    console.log(
      `  ${variant.name.padEnd(14)} visitors=${String(variant.visitors).padStart(6)} ` +
      `conversions=${String(variant.conversions).padStart(5)} rate=${pct(variant.conversionRate)}` +
      (variant.isControl ? ' (control)' : ` lift=${signedPct(variant.lift)} ci=[${signedPct(variant.liftCI95[0])}, ${signedPct(variant.liftCI95[1])}] ${pValue(variant.pValue).startsWith('<') ? 'p' + pValue(variant.pValue) : 'p=' + pValue(variant.pValue)}`)
    );
  }
  if (control && treatment) {
    console.log(`  decision: ${result.decision}`);
    console.log(`  reason: ${result.reason}`);
  }
}
console.log(`\nWrote results/results.md and results/results.json (${results.length} experiments).`);
