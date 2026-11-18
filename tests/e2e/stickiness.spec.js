import { test, expect } from './fixtures.js';

test('a visitor stays in the same variant across five reloads', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SplitTag && window.SplitTag.getAssignment('exp-hero-cta'));
  const first = await page.evaluate(() => ({
    hero: window.SplitTag.getAssignment('exp-hero-cta'),
    form: window.SplitTag.getAssignment('exp-form-position'),
    visitorId: window.SplitTag._debug.visitorId,
    stored: JSON.parse(localStorage.getItem('splittag_assign') || '{}')
  }));
  expect(first.hero).toBeTruthy();
  expect(first.form).toBeTruthy();
  expect(first.stored['exp-hero-cta']).toBe(first.hero);

  for (let reload = 0; reload < 5; reload += 1) {
    await page.reload();
    await page.waitForFunction(() => window.SplitTag && window.SplitTag.getAssignment('exp-hero-cta'));
    const current = await page.evaluate(() => ({
      hero: window.SplitTag.getAssignment('exp-hero-cta'),
      form: window.SplitTag.getAssignment('exp-form-position'),
      visitorId: window.SplitTag._debug.visitorId
    }));
    expect(current.hero, `reload ${reload + 1}`).toBe(first.hero);
    expect(current.form, `reload ${reload + 1}`).toBe(first.form);
    expect(current.visitorId, `reload ${reload + 1}`).toBe(first.visitorId);
  }
});
