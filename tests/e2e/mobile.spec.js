import { test, expect } from './fixtures.js';

test('the forced variant renders without horizontal overflow', async ({ page }) => {
  await page.goto('/?splittag_force=exp-form-position:form-first');
  await expect(page.locator('#testimonials')).toBeHidden();
  await expect(page.locator('#lead-form')).toBeVisible();

  const widths = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    innerWidth: window.innerWidth
  }));
  expect(widths.scrollWidth, `scrollWidth ${widths.scrollWidth} > innerWidth ${widths.innerWidth}`)
    .toBeLessThanOrEqual(widths.innerWidth + 1);
});
