import { test, expect } from './fixtures.js';
import { URGENCY_HEADLINE } from './constants.js';

test('force/preview mode sends no exposure or conversion events', async ({ page, eventSink }) => {
  await page.goto('/?splittag_force=exp-hero-cta:urgency');
  await expect(page.locator('#hero-headline')).toHaveText(URGENCY_HEADLINE);
  expect(await page.evaluate(() => window.SplitTag.preview)).toBe(true);

  await page.locator('#cta-primary').click();
  await page.locator('#lead-email').fill('qa@example.com');
  await page.locator('#lead-submit').click();
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, document.documentElement.scrollHeight);
    window.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(1400);

  expect(eventSink, 'preview traffic must never reach /api/events').toHaveLength(0);
});
