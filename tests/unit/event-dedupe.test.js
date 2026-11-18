import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, computeResults } from '../../server/stats.js';

const experiment = {
  id: 'exp-dedupe',
  name: 'Dedupe',
  status: 'running',
  targetUrlPattern: '/',
  trafficAllocation: 1,
  variants: [
    { id: 'control', name: 'Control', weight: 0.5, changes: [] },
    { id: 'v1', name: 'Variant', weight: 0.5, changes: [] }
  ],
  goals: [
    { id: 'g-click', name: 'Click', type: 'click', selector: '#x' },
    { id: 'g-form', name: 'Form', type: 'form_submit', selector: '#f' }
  ]
};

const base = { experimentId: 'exp-dedupe', variantId: 'v1', timestamp: 1 };

test('a visitor converting the same goal twice counts once', () => {
  const events = [
    { ...base, type: 'exposure', visitorId: 'a' },
    { ...base, type: 'goal', goalId: 'g-click', visitorId: 'a' },
    { ...base, type: 'goal', goalId: 'g-click', visitorId: 'a' }
  ];
  const agg = aggregate(events, experiment);
  const variant = agg.variants.find((item) => item.id === 'v1');
  assert.equal(variant.visitors, 1);
  assert.equal(variant.conversions, 1);
  assert.equal(variant.conversionRate, 1);
  assert.equal(variant.goals.find((goal) => goal.goalId === 'g-click').conversions, 1);
});

test('duplicate exposure events count one visitor', () => {
  const events = [
    { ...base, type: 'exposure', visitorId: 'a' },
    { ...base, type: 'exposure', visitorId: 'a' },
    { ...base, type: 'goal', goalId: 'g-click', visitorId: 'a' }
  ];
  const agg = aggregate(events, experiment);
  assert.equal(agg.variants.find((item) => item.id === 'v1').visitors, 1);
});

test('two goals from one visitor count as one converting visitor but two goal conversions', () => {
  const events = [
    { ...base, type: 'exposure', visitorId: 'a' },
    { ...base, type: 'exposure', visitorId: 'b' },
    { ...base, type: 'goal', goalId: 'g-click', visitorId: 'a' },
    { ...base, type: 'goal', goalId: 'g-form', visitorId: 'a' },
    { ...base, type: 'goal', goalId: 'g-click', visitorId: 'b' }
  ];
  const agg = aggregate(events, experiment);
  const variant = agg.variants.find((item) => item.id === 'v1');
  assert.equal(variant.visitors, 2);
  assert.equal(variant.conversions, 2);
  assert.equal(variant.goals.find((goal) => goal.goalId === 'g-click').conversions, 2);
  assert.equal(variant.goals.find((goal) => goal.goalId === 'g-form').conversions, 1);
});

test('conversions from visitors without an exposure are not silently dropped', () => {
  const events = [
    { ...base, type: 'goal', goalId: 'g-click', visitorId: 'a' },
    { ...base, type: 'goal', goalId: 'g-click', visitorId: 'b' }
  ];
  const agg = aggregate(events, experiment);
  const variant = agg.variants.find((item) => item.id === 'v1');
  assert.equal(variant.visitors, 2);
  assert.equal(variant.conversions, 2);
});

test('computeResults counts a repeat converter once and produces a decision', () => {
  const events = [];
  for (let i = 0; i < 500; i += 1) {
    const variantId = i % 2 === 0 ? 'control' : 'v1';
    events.push({ type: 'exposure', experimentId: 'exp-dedupe', variantId, visitorId: `v${i}`, timestamp: i });
    if (i < 100) {
      events.push({ type: 'goal', goalId: 'g-click', experimentId: 'exp-dedupe', variantId, visitorId: `v${i}`, timestamp: i });
      events.push({ type: 'goal', goalId: 'g-click', experimentId: 'exp-dedupe', variantId, visitorId: `v${i}`, timestamp: i + 1 });
    }
  }
  const result = computeResults(experiment, events);
  for (const variant of result.variants) {
    assert.equal(variant.visitors, 250);
    assert.equal(variant.conversions, 50);
    assert.equal(variant.conversionRate, 0.2);
  }
  assert.ok(['SHIP', 'NO-SHIP', 'KEEP RUNNING'].includes(result.decision));
});
