/**
 * SplitTag Express API and static host.
 * @module server/index
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  listExperiments,
  getExperiment,
  saveExperiment,
  deleteExperiment,
  listEvents,
  appendEvent,
  appendEvents,
  ValidationError
} from './store.js';
import { computeResults } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const CONFIG_MARKER = '/*__SPLITTAG_CONFIG__*/null';

/**
 * Minimal config payload consumed by the pre-paint snippet. No names, no
 * goals descriptions, no editor-only fields.
 * @param {object} exp
 */
function toPublicExperiment(exp) {
  return {
    id: exp.id,
    targetUrlPattern: exp.targetUrlPattern,
    trafficAllocation: exp.trafficAllocation,
    variants: exp.variants.map((variant) => ({
      id: variant.id,
      weight: variant.weight,
      changes: variant.changes
    })),
    goals: exp.goals.map((goal) => ({
      id: goal.id,
      type: goal.type,
      ...(goal.selector ? { selector: goal.selector } : {}),
      ...(goal.threshold !== undefined ? { threshold: goal.threshold } : {})
    }))
  };
}

/**
 * Experiments visible to the snippet. Normally only running experiments; QA
 * and editor preview requests may see every status so draft variants can be
 * inspected before launch.
 */
function snippetExperiments(req) {
  const includeAll = Boolean(
    req.query.splittag_force || req.query.preview === '1' || req.query.splittag_editor === '1'
  );
  return listExperiments()
    .filter((exp) => includeAll || exp.status === 'running')
    .map(toPublicExperiment);
}

function configPayload(req) {
  return { version: 1, experiments: snippetExperiments(req) };
}

function escapeForInlineScript(json) {
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Build the Express application.
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Demo landing page is rendered with a fresh inline config so the snippet
  // takes the zero-latency path and never needs a network round trip.
  app.get('/', (req, res, next) => {
    try {
      const html = fs.readFileSync(INDEX_HTML, 'utf8');
      const json = escapeForInlineScript(JSON.stringify(configPayload(req)));
      if (!html.includes(CONFIG_MARKER)) {
        throw new Error('index.html is missing the SplitTag config marker');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(html.replace(CONFIG_MARKER, json));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(configPayload(req));
  });

  app.get('/api/experiments', (req, res) => {
    res.json(listExperiments());
  });

  app.get('/api/experiments/:id', (req, res) => {
    const experiment = getExperiment(req.params.id);
    if (!experiment) return res.status(404).json({ error: `No experiment with id "${req.params.id}"` });
    return res.json(experiment);
  });

  app.post('/api/experiments', (req, res, next) => {
    try {
      const existed = Boolean(getExperiment(req.body?.id));
      const saved = saveExperiment(req.body);
      res.status(existed ? 200 : 201).json(saved);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/experiments/:id', (req, res) => {
    const removed = deleteExperiment(req.params.id);
    if (!removed) return res.status(404).json({ error: `No experiment with id "${req.params.id}"` });
    return res.json({ deleted: req.params.id });
  });

  app.post('/api/events', (req, res, next) => {
    try {
      const body = req.body;
      if (Array.isArray(body)) {
        if (body.length === 0) throw new ValidationError('Event batch must contain at least one event');
        if (body.length > 1000) throw new ValidationError('Event batch may not exceed 1000 events');
        const count = appendEvents(body);
        return res.status(202).json({ accepted: count });
      }
      if (!body || typeof body !== 'object') {
        throw new ValidationError('POST /api/events expects an event object or an array of events');
      }
      const stored = appendEvent(body);
      return res.status(202).json({ accepted: 1, event: stored });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/api/results/:id', (req, res) => {
    const experiment = getExperiment(req.params.id);
    if (!experiment) {
      return res.status(404).json({ error: `No experiment with id "${req.params.id}"` });
    }
    const events = listEvents({ experimentId: experiment.id });
    return res.json(computeResults(experiment, events));
  });

  app.get('/api/events', (req, res) => {
    // Read-only introspection endpoint, handy for debugging the tracker.
    const filter = {};
    for (const key of ['experimentId', 'visitorId', 'variantId', 'type', 'goalId']) {
      if (typeof req.query[key] === 'string') filter[key] = req.query[key];
    }
    res.json(listEvents(filter));
  });

  // The canonical bucketing implementation is shared with the snippet and the
  // Node traffic simulator.
  app.use('/shared', express.static(path.join(ROOT, 'shared'), {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
  }));

  app.use(express.static(PUBLIC_DIR, {
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(`${path.sep}snippet.js`) || filePath.endsWith(`${path.sep}tracking.js`)) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
      }
    }
  }));

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError || err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body must be valid JSON' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number.parseInt(process.env.PORT || '4000', 10);
  const app = createApp();
  app.listen(port, () => {
    console.log(`SplitTag listening on http://localhost:${port}`);
    console.log(`  demo     http://localhost:${port}/`);
    console.log(`  editor   http://localhost:${port}/editor.html`);
    console.log(`  results  http://localhost:${port}/results.html`);
  });
}

export default createApp;
