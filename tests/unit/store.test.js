import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splittag-store-'));
process.env.SPLITTAG_DATA_DIR = dataDir;
const store = await import('../../server/store.js');

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function validExperiment(overrides = {}) {
  return {
    id: 'exp-test',
    name: 'Store test',
    status: 'running',
    targetUrlPattern: '/',
    trafficAllocation: 1,
    variants: [
      { id: 'control', name: 'Control', weight: 0.5, changes: [] },
      {
        id: 'v1',
        name: 'Variant',
        weight: 0.5,
        changes: [{ type: 'text', selector: '#hero-headline', value: 'Hello' }]
      }
    ],
    goals: [{ id: 'g1', name: 'CTA', type: 'click', selector: '#cta-primary' }],
    ...overrides
  };
}

function validEvent(overrides = {}) {
  return {
    type: 'goal',
    visitorId: 'vid_123',
    experimentId: 'exp-test',
    variantId: 'v1',
    goalId: 'g1',
    timestamp: Date.now(),
    ...overrides
  };
}

test('valid experiment config passes schema validation', () => {
  assert.doesNotThrow(() => store.validateExperiment(validExperiment()));
});

test('schema validation rejects bad experiment configs with clear messages', () => {
  const cases = [
    [validExperiment({ status: 'live' }), /status must be one of/],
    [validExperiment({ trafficAllocation: 1.2 }), /trafficAllocation must be a number/],
    [validExperiment({ variants: [] }), /variants must be a non-empty array/],
    [validExperiment({ name: '' }), /name must be a non-empty string/],
    [validExperiment({
      variants: [
        { id: 'control', name: 'Control', weight: 0.7, changes: [] },
        { id: 'v1', name: 'Variant', weight: 0.7, changes: [] }
      ]
    }), /weights must sum to 1 or less/],
    [validExperiment({
      variants: [
        { id: 'control', name: 'Control', weight: 0.5, changes: [] },
        { id: 'v1', name: 'Variant', weight: 0.5, changes: [{ type: 'nope', selector: '#x' }] }
      ]
    }), /type must be one of/],
    [validExperiment({
      goals: [{ id: 'g1', name: 'CTA', type: 'click' }]
    }), /selector must be a non-empty string/],
    [validExperiment({
      goals: [{ id: 'g1', name: 'Scroll', type: 'scroll_depth', threshold: 150 }]
    }), /threshold must be a number between 1 and 100/],
    [validExperiment({
      variants: [
        { id: 'dup', name: 'Control', weight: 0.5, changes: [] },
        { id: 'dup', name: 'Variant', weight: 0.5, changes: [] }
      ]
    }), /Duplicate variant id/]
  ];
  for (const [config, pattern] of cases) {
    assert.throws(() => store.validateExperiment(config), (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.match(err.message, pattern);
      return true;
    });
  }
});

test('schema validation rejects malformed events', () => {
  assert.doesNotThrow(() => store.validateEvent(validEvent()));
  const cases = [
    [validEvent({ visitorId: '' }), /visitorId must be a non-empty string/],
    [validEvent({ type: 'click' }), /type must be "exposure" or "goal"/],
    [validEvent({ goalId: undefined }), /goalId must be a non-empty string/],
    [validEvent({ timestamp: 'now' }), /timestamp must be a finite/],
    [validEvent({ meta: 'not-an-object' }), /meta must be an object/],
    [null, /Each event must be an object/]
  ];
  for (const [event, pattern] of cases) {
    assert.throws(() => store.validateEvent(event), (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.match(err.message, pattern);
      return true;
    });
  }
});

test('store creates files on first use and round-trips experiments', () => {
  assert.deepEqual(store.listExperiments(), []);
  assert.equal(fs.existsSync(path.join(dataDir, 'experiments.json')), true);
  store.saveExperiment(validExperiment());
  assert.equal(store.listExperiments().length, 1);
  assert.equal(store.getExperiment('exp-test').name, 'Store test');
  store.saveExperiment(validExperiment({ name: 'Renamed' }));
  assert.equal(store.listExperiments().length, 1);
  assert.equal(store.getExperiment('exp-test').name, 'Renamed');
  assert.equal(store.deleteExperiment('exp-test'), true);
  assert.equal(store.deleteExperiment('exp-test'), false);
  assert.deepEqual(store.listExperiments(), []);
});

test('appendEvent stamps ids and listEvents filters', () => {
  const stored = store.appendEvent(validEvent());
  assert.ok(stored.id);
  assert.ok(Number.isFinite(stored.receivedAt));
  store.appendEvent(validEvent({ type: 'exposure', goalId: undefined, visitorId: 'vid_other' }));
  assert.equal(store.listEvents().length, 2);
  assert.equal(store.listEvents({ visitorId: 'vid_123' }).length, 1);
  assert.equal(store.listEvents({ type: 'exposure' }).length, 1);
  assert.equal(store.listEvents({ experimentId: 'exp-test' }).length, 2);
});
