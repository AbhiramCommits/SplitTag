import { test, expect } from './fixtures.js';

test('the results dashboard shows both variants and a decision badge', async ({ page }) => {
  await page.goto('/results.html');
  await expect(page.locator('#experiment-picker option')).toHaveCount(2);
  await expect(page.locator('#decision-badge')).toHaveText('SHIP', { timeout: 15000 });
  await expect(page.locator('#variant-rows tr')).toHaveCount(2);
  await expect(page.locator('#variant-rows')).toContainText('Control');
  await expect(page.locator('#variant-rows')).toContainText('Urgency');
  await expect(page.locator('#chart .chart-bar')).toHaveCount(2);
  await expect(page.locator('#decision-reason')).toContainText('Urgency lifts conversion');

  await page.locator('#experiment-picker').selectOption('exp-form-position');
  await expect(page.locator('#decision-badge')).toHaveText('NO-SHIP');
  await expect(page.locator('#variant-rows')).toContainText('Form first');
  await expect(page.locator('#decision-reason')).toContainText('keep the control');
});
