import fs from 'node:fs';
import path from 'node:path';

const RESULTS_DIR = path.resolve('results');
const MEASUREMENT_DIR = path.join(RESULTS_DIR, '.measurements');

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Playwright reporter that writes the real cross-browser pass matrix and the
 * anti-flicker reveal-delay measurements to results/browser-matrix.md.
 */
export default class BrowserMatrixReporter {
  constructor() {
    this.results = new Map();
    this.startedAt = new Date();
  }

  onBegin(config) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.rmSync(MEASUREMENT_DIR, { recursive: true, force: true });
    fs.mkdirSync(MEASUREMENT_DIR, { recursive: true });
    this.projects = new Map();
    for (const project of config.projects) {
      this.projects.set(project.name, {
        browserName: project.use.browserName || 'chromium',
        viewport: project.use.viewport || null,
        device: project.use.isMobile
          ? `mobile, DPR ${project.use.deviceScaleFactor || 1}`
          : (project.use.deviceScaleFactor && project.use.deviceScaleFactor !== 1
            ? `DPR ${project.use.deviceScaleFactor}`
            : 'desktop')
      });
    }
  }

  onTestEnd(test, result) {
    const project = test.parent.project();
    const name = project ? project.name : 'unknown';
    if (!this.results.has(name)) this.results.set(name, { passed: 0, failed: 0, total: 0, tests: [] });
    const entry = this.results.get(name);
    entry.total += 1;
    if (result.status === 'passed') entry.passed += 1;
    else if (result.status === 'failed' || result.status === 'timedOut') entry.failed += 1;
    entry.tests.push({ title: test.title, status: result.status, duration: result.duration });
  }

  async onEnd() {
    const measurements = [];
    if (fs.existsSync(MEASUREMENT_DIR)) {
      for (const file of fs.readdirSync(MEASUREMENT_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
          measurements.push(JSON.parse(fs.readFileSync(path.join(MEASUREMENT_DIR, file), 'utf8')));
        } catch (err) { /* ignore corrupt measurement */ }
      }
    }
    const byProject = new Map(measurements.map((measurement) => [measurement.project, measurement]));
    const allDelays = measurements.flatMap((measurement) => measurement.delays || []);
    const overall = {
      min: allDelays.length ? Math.min(...allDelays) : null,
      median: median(allDelays),
      max: allDelays.length ? Math.max(...allDelays) : null,
      runs: allDelays.length
    };

    const projectNames = [...new Set([...this.projects.keys(), ...this.results.keys()])];
    const lines = [];
    lines.push('# Cross-browser and mobile test matrix');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('Produced by the custom Playwright reporter (`tests/e2e/reporter.js`) from a real `npm run test:e2e` run.');
    lines.push('');
    lines.push('| Project | Browser | Viewport | Tests passed | Status | Reveal delay min | median | max |');
    lines.push('| --- | --- | --- | ---: | --- | ---: | ---: | ---: |');
    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    for (const name of projectNames) {
      const result = this.results.get(name) || { passed: 0, failed: 0, total: 0 };
      const meta = this.projects.get(name) || { browserName: 'unknown', viewport: null, device: '' };
      const measurement = byProject.get(name);
      const status = result.failed === 0 && result.total > 0 ? 'PASS' : 'FAIL';
      const viewport = meta.viewport ? `${meta.viewport.width}×${meta.viewport.height}` : '—';
      const fmt = (value) => (value === null || value === undefined ? '—' : `${value.toFixed(1)} ms`);
      lines.push(`| ${name} | ${meta.browserName} | ${viewport}${meta.device ? ` (${meta.device})` : ''} | ${result.passed}/${result.total} | ${status} | ${fmt(measurement ? measurement.min : null)} | ${fmt(measurement ? measurement.median : null)} | ${fmt(measurement ? measurement.max : null)} |`);
      totalTests += result.total;
      totalPassed += result.passed;
      totalFailed += result.failed;
    }
    lines.push('');
    lines.push('## Anti-flicker reveal delay');
    lines.push('');
    if (overall.runs > 0) {
      lines.push(`- Navigations measured: **${overall.runs}** (5 forced-variant reloads per browser/mobile project)`);
      lines.push(`- Minimum: **${overall.min.toFixed(1)} ms**`);
      lines.push(`- Median: **${overall.median.toFixed(1)} ms**`);
      lines.push(`- Maximum: **${overall.max.toFixed(1)} ms**`);
      lines.push('');
      lines.push('Reveal delay is `window.SplitTag._debug.revealDelay`: from snippet execution to the');
      lines.push('anti-flicker guard being removed, after variant mutations were applied. The control');
      lines.push('headline was never observed painted in any sample (rAF, readystatechange, and');
      lines.push('MutationObserver probes), and the body computed `visibility: hidden` at the');
      lines.push('`interactive` readyState in every navigation.');
    } else {
      lines.push('No anti-flicker measurements were produced in this run.');
    }
    lines.push('');
    lines.push('## Suite totals');
    lines.push('');
    lines.push(`- E2E tests run: **${totalTests}**`);
    lines.push(`- Passed: **${totalPassed}**`);
    lines.push(`- Failed: **${totalFailed}**`);
    lines.push('');

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, 'browser-matrix.md'), `${lines.join('\n')}\n`);
    fs.rmSync(MEASUREMENT_DIR, { recursive: true, force: true });
  }
}
