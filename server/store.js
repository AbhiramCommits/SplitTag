/**
 * JSON-file persistence for SplitTag.
 *
 * All reads/writes are synchronous and atomic (write to a temp file, then
 * rename) so that a crash or concurrent request can never leave a truncated
 * JSON document behind. Files under data/ are created on first use.
 *
 * @module server/store
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.SPLITTAG_DATA_DIR
  ? path.resolve(process.env.SPLITTAG_DATA_DIR)
  : path.join(ROOT, 'data');
const EXPERIMENTS_FILE = path.join(DATA_DIR, 'experiments.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

const STATUSES = new Set(['draft', 'running', 'stopped']);
const GOAL_TYPES = new Set(['click', 'form_submit', 'scroll_depth']);
const CHANGE_TYPES = new Set(['text', 'html', 'style', 'class', 'hide', 'move', 'attr']);
const EVENT_TYPES = new Set(['exposure', 'goal']);

/** Error carrying an HTTP 400-friendly validation message. */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) {
    writeJson(file, fallback);
    return fallback;
  }
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in ${file}: ${err.message}`);
  }
}

function writeJson(file, value) {
  ensureDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new ValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNumber(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`${label} must be a number between ${min} and ${max}`);
  }
  return value;
}

/**
 * Validate a single mutation object from an experiment variant.
 * @param {object} change
 * @param {string} label
 */
export function validateChange(change, label = 'change') {
  if (!isPlainObject(change)) throw new ValidationError(`${label} must be an object`);
  if (!CHANGE_TYPES.has(change.type)) {
    throw new ValidationError(`${label}.type must be one of: ${[...CHANGE_TYPES].join(', ')}`);
  }
  requireString(change.selector, `${label}.selector`);

  switch (change.type) {
    case 'text':
    case 'html':
      if (typeof change.value !== 'string') {
        throw new ValidationError(`${label}.value must be a string`);
      }
      break;
    case 'style':
      if (!isPlainObject(change.props) || Object.keys(change.props).length === 0) {
        throw new ValidationError(`${label}.props must be a non-empty object of CSS properties`);
      }
      for (const [key, value] of Object.entries(change.props)) {
        if (typeof value !== 'string' && typeof value !== 'number') {
          throw new ValidationError(`${label}.props.${key} must be a string or number`);
        }
      }
      break;
    case 'class':
      for (const field of ['add', 'remove']) {
        if (change[field] !== undefined &&
            (!Array.isArray(change[field]) || change[field].some((c) => typeof c !== 'string'))) {
          throw new ValidationError(`${label}.${field} must be an array of class-name strings`);
        }
      }
      if (!change.add?.length && !change.remove?.length) {
        throw new ValidationError(`${label} must add or remove at least one class`);
      }
      break;
    case 'hide':
      break;
    case 'move':
      if (Boolean(change.beforeSelector) === Boolean(change.afterSelector)) {
        throw new ValidationError(`${label} must include exactly one of beforeSelector or afterSelector`);
      }
      requireString(change.beforeSelector || change.afterSelector, `${label}.beforeSelector/afterSelector`);
      break;
    case 'attr':
      requireString(change.name, `${label}.name`);
      if (typeof change.value !== 'string') {
        throw new ValidationError(`${label}.value must be a string`);
      }
      break;
    default:
      throw new ValidationError(`${label}.type is not supported`);
  }
  return change;
}

/**
 * Validate an experiment config. Throws ValidationError on the first problem.
 * @param {object} exp
 * @returns {object} the same experiment
 */
export function validateExperiment(exp) {
  if (!isPlainObject(exp)) throw new ValidationError('Experiment must be an object');
  if (typeof exp.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(exp.id)) {
    throw new ValidationError('id must be 1-64 characters of letters, numbers, dash or underscore');
  }
  requireString(exp.name, 'name');
  if (!STATUSES.has(exp.status)) {
    throw new ValidationError('status must be one of: draft, running, stopped');
  }
  requireString(exp.targetUrlPattern, 'targetUrlPattern');
  requireNumber(exp.trafficAllocation, 'trafficAllocation', 0, 1);

  if (!Array.isArray(exp.variants) || exp.variants.length === 0) {
    throw new ValidationError('variants must be a non-empty array');
  }
  if (exp.variants.length > 20) throw new ValidationError('variants may not exceed 20');
  const variantIds = new Set();
  let weightSum = 0;
  exp.variants.forEach((variant, index) => {
    const label = `variants[${index}]`;
    if (!isPlainObject(variant)) throw new ValidationError(`${label} must be an object`);
    requireString(variant.id, `${label}.id`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(variant.id)) {
      throw new ValidationError(`${label}.id must be 1-64 characters of letters, numbers, dash or underscore`);
    }
    if (variantIds.has(variant.id)) throw new ValidationError(`Duplicate variant id: ${variant.id}`);
    variantIds.add(variant.id);
    requireString(variant.name, `${label}.name`);
    requireNumber(variant.weight, `${label}.weight`, 0, 1);
    weightSum += variant.weight;
    if (!Array.isArray(variant.changes)) {
      throw new ValidationError(`${label}.changes must be an array`);
    }
    variant.changes.forEach((change, ci) => validateChange(change, `${label}.changes[${ci}]`));
  });
  if (weightSum <= 0) throw new ValidationError('Variant weights must sum to more than 0');
  if (weightSum > 1.0001) throw new ValidationError('Variant weights must sum to 1 or less');

  if (!Array.isArray(exp.goals)) throw new ValidationError('goals must be an array');
  const goalIds = new Set();
  exp.goals.forEach((goal, index) => {
    const label = `goals[${index}]`;
    if (!isPlainObject(goal)) throw new ValidationError(`${label} must be an object`);
    requireString(goal.id, `${label}.id`);
    if (goalIds.has(goal.id)) throw new ValidationError(`Duplicate goal id: ${goal.id}`);
    goalIds.add(goal.id);
    requireString(goal.name, `${label}.name`);
    if (!GOAL_TYPES.has(goal.type)) {
      throw new ValidationError(`${label}.type must be one of: click, form_submit, scroll_depth`);
    }
    if (goal.type === 'click' || goal.type === 'form_submit') {
      requireString(goal.selector, `${label}.selector`);
    }
    if (goal.type === 'scroll_depth') {
      requireNumber(goal.threshold, `${label}.threshold`, 1, 100);
    }
  });

  return exp;
}

/**
 * Normalize and validate an inbound tracking event.
 * @param {object} evt
 * @returns {object} normalized event (without server-generated fields)
 */
export function validateEvent(evt) {
  if (!isPlainObject(evt)) throw new ValidationError('Each event must be an object');
  requireString(evt.visitorId, 'event.visitorId');
  if (evt.visitorId.length > 128) throw new ValidationError('event.visitorId is too long');
  requireString(evt.experimentId, 'event.experimentId');
  requireString(evt.variantId, 'event.variantId');
  if (!EVENT_TYPES.has(evt.type)) {
    throw new ValidationError('event.type must be "exposure" or "goal"');
  }
  if (typeof evt.timestamp !== 'number' || !Number.isFinite(evt.timestamp)) {
    throw new ValidationError('event.timestamp must be a finite Unix-millisecond number');
  }
  if (evt.type === 'goal') {
    requireString(evt.goalId, 'event.goalId');
  }
  if (evt.url !== undefined && typeof evt.url !== 'string') {
    throw new ValidationError('event.url must be a string when present');
  }
  if (evt.meta !== undefined && !isPlainObject(evt.meta)) {
    throw new ValidationError('event.meta must be an object when present');
  }
  return {
    type: evt.type,
    visitorId: evt.visitorId,
    experimentId: evt.experimentId,
    variantId: evt.variantId,
    ...(evt.goalId ? { goalId: evt.goalId } : {}),
    timestamp: evt.timestamp,
    ...(evt.url ? { url: evt.url } : {}),
    ...(evt.meta ? { meta: evt.meta } : {})
  };
}

/**
 * List every experiment.
 * @returns {object[]}
 */
export function listExperiments() {
  const experiments = readJson(EXPERIMENTS_FILE, []);
  return Array.isArray(experiments) ? experiments : [];
}

/**
 * Get one experiment by id.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getExperiment(id) {
  return listExperiments().find((exp) => exp.id === id);
}

/**
 * Create or update an experiment (upsert by id).
 * @param {object} obj
 * @returns {object} saved experiment
 */
export function saveExperiment(obj) {
  const experiment = validateExperiment({ ...obj });
  const experiments = listExperiments();
  const index = experiments.findIndex((exp) => exp.id === experiment.id);
  if (index >= 0) experiments[index] = experiment;
  else experiments.push(experiment);
  writeJson(EXPERIMENTS_FILE, experiments);
  return experiment;
}

/**
 * Delete an experiment.
 * @param {string} id
 * @returns {boolean} whether anything was removed
 */
export function deleteExperiment(id) {
  const experiments = listExperiments();
  const next = experiments.filter((exp) => exp.id !== id);
  if (next.length === experiments.length) return false;
  writeJson(EXPERIMENTS_FILE, next);
  return true;
}

/**
 * Append one event, stamping it with a server id and receipt time.
 * @param {object} evt
 * @returns {object} stored event
 */
export function appendEvent(evt) {
  const normalized = validateEvent(evt);
  const stored = {
    id: crypto.randomUUID(),
    ...normalized,
    receivedAt: Date.now()
  };
  const events = readJson(EVENTS_FILE, []);
  events.push(stored);
  writeJson(EVENTS_FILE, events);
  return stored;
}

/**
 * Append many events in one atomic write.
 * @param {object[]} events
 * @returns {number} count stored
 */
export function appendEvents(events) {
  const normalized = events.map((evt) => validateEvent(evt));
  const stored = readJson(EVENTS_FILE, []);
  const now = Date.now();
  for (const evt of normalized) {
    stored.push({ id: crypto.randomUUID(), ...evt, receivedAt: now });
  }
  writeJson(EVENTS_FILE, stored);
  return normalized.length;
}

/**
 * List events, optionally filtered by exact-match fields.
 * @param {{experimentId?:string, visitorId?:string, variantId?:string, type?:string, goalId?:string}} [filter]
 * @returns {object[]}
 */
export function listEvents(filter = {}) {
  const events = readJson(EVENTS_FILE, []);
  if (!Array.isArray(events)) return [];
  const entries = Object.entries(filter || {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return events;
  return events.filter((evt) => entries.every(([key, value]) => evt[key] === value));
}

/**
 * Replace all events (used by the reset tool).
 * @param {object[]} events
 */
export function replaceEvents(events) {
  writeJson(EVENTS_FILE, events);
}

/**
 * Replace all experiments (used by the reset tool).
 * @param {object[]} experiments
 */
export function replaceExperiments(experiments) {
  for (const exp of experiments) validateExperiment(exp);
  writeJson(EXPERIMENTS_FILE, experiments);
}

export const dataPaths = { DATA_DIR, EXPERIMENTS_FILE, EVENTS_FILE };
