import test from 'node:test';
import assert from 'node:assert/strict';
import {
  erf,
  normalCdf,
  normalQuantile,
  twoProportionZTest,
  proportionCI95,
  requiredSampleSize,
  decide,
  explainDecision,
  computeResults
} from '../../server/stats.js';

const close = (actual, expected, tolerance = 1e-6, label = '') => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual} (tolerance ${tolerance})`);
};

test('erf and normalCdf match known values', () => {
  close(erf(0), 0, 1e-12, 'erf(0)');
  close(erf(1), 0.8427007929497149, 2e-7, 'erf(1)');
  close(normalCdf(0), 0.5, 1e-12, 'cdf(0)');
  close(normalCdf(1), 0.8413447460685429, 2e-7, 'cdf(1)');
  close(normalCdf(1.96), 0.9750021048517795, 5e-7, 'cdf(1.96)');
  close(normalCdf(-1.96), 0.0249978951482205, 5e-7, 'cdf(-1.96)');
  close(normalCdf(2.5758293035489004), 0.995, 5e-7, 'cdf(2.576)');
});

test('normalQuantile inverts normalCdf', () => {
  close(normalQuantile(0.975), 1.959963984540054, 1e-4, 'q(.975)');
  close(normalQuantile(0.8), 0.8416212335729143, 1e-4, 'q(.8)');
  close(normalQuantile(0.5), 0, 1e-9, 'q(.5)');
});

test('two-proportion z-test matches a hand-computed example', () => {
  const result = twoProportionZTest(100, 1000, 130, 1000);
  const p1 = 0.1;
  const p2 = 0.13;
  const pooled = 0.115;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / 1000 + 1 / 1000));
  const z = (p2 - p1) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const seU = Math.sqrt((p1 * (1 - p1)) / 1000 + (p2 * (1 - p2)) / 1000);
  const lo = (p2 - p1) - 1.959963984540054 * seU;
  const hi = (p2 - p1) + 1.959963984540054 * seU;

  close(result.zScore, z, 1e-12, 'z');
  close(result.pValue, p, 1e-12, 'p');
  close(result.lift, 0.3, 1e-12, 'lift');
  close(result.liftCI95[0], lo / p1, 1e-12, 'lift CI lo');
  close(result.liftCI95[1], hi / p1, 1e-12, 'lift CI hi');
  assert.equal(result.significant, true);
});

test('z-test handles empty samples without NaN', () => {
  const result = twoProportionZTest(0, 0, 0, 0);
  assert.equal(result.pValue, 1);
  assert.equal(result.lift, 0);
  assert.deepEqual(result.liftCI95, [0, 0]);
  assert.equal(result.significant, false);
});

test('proportionCI95 brackets the observed rate', () => {
  const [lo, hi] = proportionCI95(50, 1000);
  assert.ok(lo > 0.035 && lo < 0.05);
  assert.ok(hi > 0.05 && hi < 0.065);
  assert.deepEqual(proportionCI95(0, 0), [0, 0]);
});

test('requiredSampleSize is sane and responds to effect size and power', () => {
  const baseline = requiredSampleSize(0.1, 0.02);
  assert.ok(Number.isInteger(baseline));
  assert.ok(baseline > 3000 && baseline < 5000, `n=${baseline}`);
  assert.ok(requiredSampleSize(0.1, 0.04) < baseline);
  assert.ok(requiredSampleSize(0.1, 0.01) > baseline);
  assert.ok(requiredSampleSize(0.1, 0.02, 0.01, 0.8) > baseline);
  assert.ok(requiredSampleSize(0.1, 0.02, 0.05, 0.9) > baseline);
  assert.equal(requiredSampleSize(0.1, 0), Infinity);
});

test('decide returns all three branches with a reason string', () => {
  const base = {
    requiredSampleSize: 1000,
    variants: [
      { id: 'control', isControl: true, visitors: 500, conversions: 50, conversionRate: 0.1 },
      { id: 'v1', isControl: false, visitors: 500, conversions: 60, conversionRate: 0.12 }
    ],
    test: { significant: true, lift: 0.2, pValue: 0.01 }
  };
  assert.equal(decide(base), 'KEEP RUNNING');
  assert.match(explainDecision(base), /more per arm|keep running/i);

  const powered = {
    ...base,
    variants: [
      { ...base.variants[0], visitors: 1200, conversions: 120 },
      { ...base.variants[1], visitors: 1200, conversions: 150 }
    ]
  };
  assert.equal(decide(powered), 'SHIP');
  assert.match(explainDecision(powered), /ship it/i);

  assert.equal(decide({
    ...powered,
    test: { significant: true, lift: -0.2, pValue: 0.01 }
  }), 'NO-SHIP');

  assert.equal(decide({
    ...powered,
    test: { significant: false, lift: 0.02, pValue: 0.41 }
  }), 'NO-SHIP');
  assert.match(explainDecision({ ...powered, test: { significant: false, lift: 0.02, pValue: 0.41 } }), /not statistically significant/i);

  assert.equal(decide({ variants: [] }), 'KEEP RUNNING');
});

test('computeResults produces a complete, serializable payload', () => {
  const experiment = {
    id: 'exp-unit',
    name: 'Unit experiment',
    status: 'running',
    targetUrlPattern: '/',
    trafficAllocation: 1,
    variants: [
      { id: 'control', name: 'Control', weight: 0.5, changes: [] },
      { id: 'v1', name: 'Variant', weight: 0.5, changes: [] }
    ],
    goals: [{ id: 'g1', name: 'Click', type: 'click', selector: '#x' }]
  };
  const events = [];
  for (let i = 0; i < 1200; i += 1) {
    const variantId = i % 2 === 0 ? 'control' : 'v1';
    events.push({ type: 'exposure', experimentId: 'exp-unit', variantId, visitorId: `v${i}`, timestamp: i });
    const rate = variantId === 'control' ? 0.1 : 0.15;
    if ((i * 7919) % 1000 < rate * 1000) {
      events.push({ type: 'goal', goalId: 'g1', experimentId: 'exp-unit', variantId, visitorId: `v${i}`, timestamp: i + 1 });
    }
  }
  const result = computeResults(experiment, events);
  assert.equal(result.variants.length, 2);
  assert.ok(['SHIP', 'NO-SHIP', 'KEEP RUNNING'].includes(result.decision));
  assert.equal(result.totalVisitors, 1200);
  assert.ok(result.test.pValue >= 0 && result.test.pValue <= 1);
  assert.ok(Number.isFinite(result.requiredSampleSize));
  assert.doesNotThrow(() => JSON.stringify(result));
});
