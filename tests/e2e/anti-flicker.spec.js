import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { CONTROL_HEADLINE, URGENCY_HEADLINE } from './constants.js';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

test('the control headline is never painted before the forced variant is applied', async ({ page }, testInfo) => {
  const delays = [];
  const probeRuns = [];

  await page.addInitScript(({ controlText }) => {
    const state = {
      controlText,
      states: [],
      visibleControl: [],
      hiddenSeen: false,
      samples: 0,
      firstVisibleText: null
    };
    window.__flickerProbe = state;

    function inspect(source) {
      const html = document.documentElement;
      const body = document.body;
      const headline = document.getElementById('hero-headline');
      const htmlVisibility = html ? getComputedStyle(html).visibility : '';
      const bodyVisibility = body ? getComputedStyle(body).visibility : '';
      if (htmlVisibility === 'hidden' || bodyVisibility === 'hidden') state.hiddenSeen = true;
      if (headline && htmlVisibility !== 'hidden' && bodyVisibility !== 'hidden' &&
          headline.textContent.trim() === controlText) {
        state.visibleControl.push({ source, at: performance.now() });
      }
      if (!state.firstVisibleText && htmlVisibility !== 'hidden' && body &&
          body.innerText && body.innerText.trim()) {
        state.firstVisibleText = body.innerText.trim().slice(0, 180);
      }
      return {
        bodyVisibility,
        htmlVisibility,
        headline: headline ? headline.textContent.trim() : null
      };
    }

    requestAnimationFrame(function tick() {
      state.samples += 1;
      inspect('raf');
      requestAnimationFrame(tick);
    });

    document.addEventListener('readystatechange', () => {
      state.states.push({ state: document.readyState, at: performance.now(), ...inspect('readystatechange') });
    });

    new MutationObserver(() => inspect('mutation')).observe(document, { childList: true, subtree: true });
  }, { controlText: CONTROL_HEADLINE });

  for (let run = 0; run < 5; run += 1) {
    await page.goto('/?splittag_force=exp-hero-cta:urgency', { waitUntil: 'load' });
    await page.waitForTimeout(120);

    const probe = await page.evaluate(() => window.__flickerProbe);
    const debug = await page.evaluate(() => window.SplitTag._debug);

    expect(probe.visibleControl, `run ${run}: the control headline was painted`).toHaveLength(0);
    expect(probe.hiddenSeen, `run ${run}: body/html was never observed hidden`).toBe(true);

    const interactive = probe.states.find((entry) => entry.state === 'interactive');
    expect(interactive, `run ${run}: interactive readyState should be observed`).toBeTruthy();
    expect(interactive.bodyVisibility, `run ${run}: body must stay hidden at readyState interactive`).toBe('hidden');

    // A cold browser start can push DOMContentLoaded past the 1000 ms safety
    // timer while the main thread is parsing. What matters for flicker is that
    // the probe never saw the control text and that reveal came after (or via)
    // the guard, so allow a generous upper bound rather than assuming a warm run.
    expect(['changes-applied', 'safety-timeout']).toContain(debug.revealReason);
    expect(debug.revealedAt).toBeGreaterThanOrEqual(debug.changesAppliedAt || 0);
    expect(Number.isFinite(debug.revealDelay)).toBe(true);
    expect(debug.revealDelay).toBeGreaterThan(0);
    expect(debug.revealDelay).toBeLessThan(5000);

    await expect(page.locator('#hero-headline')).toHaveText(URGENCY_HEADLINE);
    delays.push(debug.revealDelay);
    probeRuns.push({
      run,
      samples: probe.samples,
      readystatechanges: probe.states.length,
      revealDelay: debug.revealDelay,
      firstVisibleText: probe.firstVisibleText
    });

    if (run === 0) {
      await page.screenshot({ path: testInfo.outputPath('after-reveal.png') });
    }
  }

  const sorted = [...delays].sort((a, b) => a - b);
  const measurement = {
    project: testInfo.project.name,
    browserName: testInfo.project.use.browserName || 'unknown',
    viewport: page.viewportSize(),
    generatedAt: new Date().toISOString(),
    delays,
    min: sorted[0],
    median: median(delays),
    max: sorted[sorted.length - 1],
    runs: probeRuns,
    pass: true
  };
  const dir = path.resolve('results/.measurements');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${testInfo.project.name.replace(/[^A-Za-z0-9_-]+/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(measurement, null, 2)}\n`);
});
