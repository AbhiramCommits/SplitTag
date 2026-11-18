#!/usr/bin/env node
/**
 * Seeded traffic simulator for SplitTag.
 *
 * This is not a fake results generator: it imports the exact FNV-1a bucketing
 * implementation used by the browser snippet, assigns synthetic visitors to
 * variants, rolls conversions against the rates you pass, and POSTs real
 * exposure/goal events to /api/events.
 *
 * Usage:
 *   node tools/simulate.js --experiment exp-hero-cta --visitors 8000 \
 *     --control-rate 0.082 --variant-rate 0.101 --seed 42
 */

import '../shared/bucketing.js';

const B = globalThis.SplitTagBucketing;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

const args = parseArgs(process.argv);
const experimentId = args.experiment || args.experimentId;
const visitors = Number(args.visitors || 8000);
const controlRate = Number(args['control-rate'] || 0.082);
const variantRate = Number(args['variant-rate'] || 0.101);
const seed = Number(args.seed || 42);
const url = String(args.url || 'http://localhost:4000').replace(/\/$/, '');
const batchSize = Number(args.batch || 1000);

if (!experimentId) {
  console.error('Usage: node tools/simulate.js --experiment <id> --visitors 8000 --control-rate 0.082 --variant-rate 0.101 --seed 42');
  process.exit(1);
}
if (!Number.isInteger(visitors) || visitors <= 0) {
  console.error('--visitors must be a positive integer');
  process.exit(1);
}
for (const [label, value] of [['control-rate', controlRate], ['variant-rate', variantRate]]) {
  if (!(value >= 0 && value <= 1)) {
    console.error(`--${label} must be between 0 and 1`);
    process.exit(1);
  }
}

let experiment;
try {
  const response = await fetch(`${url}/api/experiments/${encodeURIComponent(experimentId)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  experiment = await response.json();
} catch (err) {
  console.error(`Could not load experiment "${experimentId}" from ${url}: ${err.message}`);
  console.error('Start the server first with: npm start');
  process.exit(1);
}

const variantConfigs = experiment.variants;
const control = variantConfigs[0];
const goal = (experiment.goals || [])[0];
if (!goal) {
  console.error(`Experiment "${experimentId}" has no goals; nothing to simulate.`);
  process.exit(1);
}

const random = mulberry32((seed ^ B.fnv1a32(experiment.id) ^ 0x9e3779b9) >>> 0);
const countByVariant = new Map(variantConfigs.map((variant) => [variant.id, {
  visitors: 0,
  conversions: 0,
  configuredRate: variant.id === control.id ? controlRate : variantRate
}]));
const events = [];
const now = Date.now();

let admitted = 0;
for (let i = 0; i < visitors; i += 1) {
  const visitorId = `sim_${seed}_${experiment.id}_${i}`;
  const decision = B.assignVariant(
    visitorId,
    experiment.id,
    variantConfigs,
    typeof experiment.trafficAllocation === 'number' ? experiment.trafficAllocation : 1
  );
  if (!decision.admitted || !decision.variantId) continue;
  admitted += 1;
  const stats = countByVariant.get(decision.variantId);
  stats.visitors += 1;

  events.push({
    type: 'exposure',
    experimentId: experiment.id,
    variantId: decision.variantId,
    visitorId,
    url: `${url}${experiment.targetUrlPattern === '/' ? '/' : experiment.targetUrlPattern}`,
    timestamp: now - (visitors - i)
  });

  const rate = decision.variantId === control.id ? controlRate : variantRate;
  if (random() < rate) {
    stats.conversions += 1;
    events.push({
      type: 'goal',
      goalId: goal.id,
      experimentId: experiment.id,
      variantId: decision.variantId,
      visitorId,
      url: `${url}${experiment.targetUrlPattern === '/' ? '/' : experiment.targetUrlPattern}`,
      timestamp: now - (visitors - i) + 500,
      meta: { simulated: true, seed }
    });
  }
}

let accepted = 0;
for (let start = 0; start < events.length; start += batchSize) {
  const batch = events.slice(start, start + batchSize);
  const response = await fetch(`${url}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch)
  });
  if (!response.ok) {
    const payload = await response.text();
    console.error(`POST /api/events failed (${response.status}): ${payload}`);
    process.exit(1);
  }
  const payload = await response.json();
  accepted += payload.accepted || batch.length;
}

console.log('');
console.log(`SplitTag simulation — ${experiment.name} (${experiment.id})`);
console.log(`server: ${url}   seed: ${seed}   requested visitors: ${visitors}`);
console.log(`goal: ${goal.name} (${goal.id})`);
console.log('');
console.log('Variant     Visitors   Conversions   Observed    Configured');
console.log('----------  ---------  -----------   ----------  ----------');
for (const variant of variantConfigs) {
  const stats = countByVariant.get(variant.id);
  const observed = stats.visitors > 0 ? stats.conversions / stats.visitors : 0;
  console.log(
    `${variant.id.padEnd(11)} ${String(stats.visitors).padStart(9)}  ${String(stats.conversions).padStart(11)}   ` +
    `${formatPct(observed).padStart(10)}  ${formatPct(stats.configuredRate).padStart(10)}`
  );
}
console.log('');
console.log(`allocated: ${admitted}/${visitors}   events POSTed: ${accepted} in ${Math.ceil(events.length / batchSize)} batch(es)`);

try {
  const response = await fetch(`${url}/api/results/${encodeURIComponent(experiment.id)}`);
  if (response.ok) {
    const results = await response.json();
    console.log(`statistics: z=${Number(results.test.zScore).toFixed(3)}  p=${Number(results.test.pValue).toFixed(4)}  lift=${(Number(results.test.lift) * 100).toFixed(2)}%`);
    console.log(`decision: ${results.decision} — ${results.reason}`);
  }
} catch (err) {
  // Results summary is best-effort; the events are already persisted.
}
console.log('');
