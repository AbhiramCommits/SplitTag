import { test as base, expect } from '@playwright/test';

/**
 * Auto fixture: every navigation's event POSTs are intercepted, recorded in
 * memory, and fulfilled. This keeps the committed data/events.json untouched
 * while tests assert exactly which events the snippet produced.
 */
export const test = base.extend({
  eventSink: [async ({ page }, use) => {
    const events = [];
    const browserName = page.context().browser() ? page.context().browser().browserType().name() : '';
    // WebKit's Playwright route layer sees navigate.sendBeacon requests but
    // exposes no postData, so intercepting them would make the payload
    // unreadable. Let WebKit write to the isolated test data dir instead and
    // read it back through /api/events.
    if (browserName === 'webkit') {
      await use(events);
      return;
    }
    await page.route('**/api/events', async (route) => {
      try {
        const body = route.request().postData();
        const parsed = body ? JSON.parse(body) : null;
        if (Array.isArray(parsed)) events.push(...parsed);
        else if (parsed) events.push(parsed);
      } catch (err) {
        // A malformed body would be a test failure elsewhere; still fulfill.
      }
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: 1 })
      });
    });
    await use(events);
    await page.unroute('**/api/events');
  }, { auto: true }]
});

export { expect };
