import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../../shared/bucketing.js';

const B = globalThis.SplitTagBucketing;

test('FNV-1a hash matches the published 32-bit test vector', () => {
  assert.equal(B.fnv1a32('hello'), 0x4f9f2cab);
  assert.equal(B.fnv1a32(''), 0x811c9dc5);
});

test('bucketing is deterministic for the same visitor and experiment', () => {
  const first = B.assignVariant('visitor-123', 'exp-hero-cta', [
    { id: 'control', weight: 0.5 },
    { id: 'urgency', weight: 0.5 }
  ], 1);
  const second = B.assignVariant('visitor-123', 'exp-hero-cta', [
    { id: 'control', weight: 0.5 },
    { id: 'urgency', weight: 0.5 }
  ], 1);
  assert.equal(first.variantId, second.variantId);
  assert.equal(first.allocationUnit, second.allocationUnit);
  assert.ok(first.allocationUnit >= 0 && first.allocationUnit < 1);
});

test('100k visitor ids land within 1.5 percentage points of configured weights', () => {
  const variants = [
    { id: 'control', weight: 0.5 },
    { id: 'urgency', weight: 0.3 },
    { id: 'social-proof', weight: 0.2 }
  ];
  const counts = { control: 0, urgency: 0, 'social-proof': 0 };
  const N = 100000;
  for (let i = 0; i < N; i += 1) {
    const decision = B.assignVariant(`dist-visitor-${i}`, 'distribution-check', variants, 1);
    assert.ok(decision.variantId, 'every admitted visitor must get a variant');
    counts[decision.variantId] += 1;
  }

  const observed = variants.map((variant) => counts[variant.id] / N);
  const deltas = observed.map((rate, index) => rate - variants[index].weight);
  variants.forEach((variant, index) => {
    assert.ok(
      Math.abs(deltas[index]) < 0.015,
      `${variant.id}: observed ${(observed[index] * 100).toFixed(3)}% vs configured ${(variant.weight * 100).toFixed(1)}%`
    );
  });

  const report = {
    generatedAt: new Date().toISOString(),
    visitors: N,
    experimentId: 'distribution-check',
    tolerancePercentagePoints: 1.5,
    variants: variants.map((variant, index) => ({
      id: variant.id,
      configured: variant.weight,
      observed: observed[index],
      deltaPercentagePoints: deltas[index] * 100
    }))
  };
  const dir = path.resolve('results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bucketing-distribution.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`bucketing distribution: ${variants.map((variant, index) => `${variant.id} ${((observed[index]) * 100).toFixed(3)}% (configured ${(variant.weight * 100).toFixed(1)}%)`).join(', ')}`);
});

test('traffic allocation admits approximately the configured share', () => {
  const N = 100000;
  let admitted = 0;
  for (let i = 0; i < N; i += 1) {
    const decision = B.assignVariant(`traffic-visitor-${i}`, 'traffic-check', [
      { id: 'control', weight: 0.5 },
      { id: 'v1', weight: 0.5 }
    ], 0.25);
    if (decision.admitted) admitted += 1;
  }
  const observed = admitted / N;
  assert.ok(Math.abs(observed - 0.25) < 0.015, `observed admission ${observed}`);
});

test('the snippet embeds the same FNV-1a implementation as the shared module', () => {
  const source = fs.readFileSync(path.resolve('public/snippet.js'), 'utf8');
  const match = source.match(/function fnv1a32\(input\) \{([\s\S]*?)\n    \}/);
  assert.ok(match, 'embedded fnv1a32 function should be present in snippet.js');
  // eslint-disable-next-line no-new-func
  const embedded = new Function('input', match[1]);
  for (const sample of ['hello', '', 'visitor-1:exp-hero-cta', 'visitor-99999:exp-form-position']) {
    assert.equal(embedded(sample), B.fnv1a32(sample), `hash mismatch for ${sample}`);
  }
});
