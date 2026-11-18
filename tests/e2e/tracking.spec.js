import { test, expect } from './fixtures.js';

test('CTA click, form submit, and scroll depth send the right goal events', async ({ page, eventSink }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SplitTag && Object.keys(window.SplitTag.getAssignments()).length === 2);
  const origin = new URL(page.url()).origin;
  const visitorId = await page.evaluate(() => window.SplitTag._debug.visitorId);

  // Chromium/Firefox route interception records the beacons in-process.
  // WebKit does not surface sendBeacon requests to Playwright routing, so the
  // same events are read back from the isolated test server's event log.
  async function allEvents() {
    const merged = new Map();
    for (const event of eventSink) {
      merged.set(`${event.type}|${event.experimentId}|${event.goalId || ''}|${event.visitorId}|${event.variantId}`, event);
    }
    try {
      const response = await fetch(`${origin}/api/events?visitorId=${encodeURIComponent(visitorId)}`);
      if (response.ok) {
        const stored = await response.json();
        for (const event of stored) {
          merged.set(`${event.type}|${event.experimentId}|${event.goalId || ''}|${event.visitorId}|${event.variantId}`, event);
        }
      }
    } catch (err) { /* route interception only */ }
    return [...merged.values()];
  }

  await page.locator('#cta-primary').click();
  await expect.poll(async () => (await allEvents()).filter((event) => event.goalId === 'cta-click').length)
    .toBeGreaterThan(0);

  await page.locator('#lead-email').fill('playwright@example.com');
  await page.locator('#lead-submit').click();
  await expect.poll(async () => (await allEvents()).filter((event) => event.goalId === 'form-submit').length)
    .toBeGreaterThan(0);

  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, document.documentElement.scrollHeight);
    window.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => (await allEvents()).filter((event) => event.goalId === 'scroll-75').length)
    .toBeGreaterThan(0);

  const events = await allEvents();
  const exposures = events.filter((event) => event.type === 'exposure');
  expect(exposures.length).toBeGreaterThanOrEqual(2);

  const click = events.find((event) => event.goalId === 'cta-click');
  expect(click).toMatchObject({
    type: 'goal',
    experimentId: 'exp-hero-cta',
    goalId: 'cta-click'
  });
  expect(click.variantId).toBeTruthy();
  expect(click.visitorId).toMatch(/^vid_/);
  expect(click.url).toMatch(/^http:\/\/127\.0\.0\.1:4100\//);
  expect(click.timestamp).toBeGreaterThan(0);

  const form = events.find((event) => event.goalId === 'form-submit');
  expect(form).toMatchObject({
    type: 'goal',
    experimentId: 'exp-form-position',
    goalId: 'form-submit'
  });

  const scroll = events.find((event) => event.goalId === 'scroll-75');
  expect(scroll.experimentId).toBe('exp-form-position');
  expect(scroll.meta.maxScrollPercent).toBeGreaterThanOrEqual(75);

  const visitorIds = new Set(events.map((event) => event.visitorId));
  expect(visitorIds.size).toBe(1);
});
