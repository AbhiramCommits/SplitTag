import { test, expect } from './fixtures.js';
import {
  CONTROL_HEADLINE,
  URGENCY_HEADLINE,
  CONTROL_CTA,
  URGENCY_CTA,
  CONTROL_BG,
  URGENCY_BG
} from './constants.js';

test('force mode applies and removes the hero urgency variant', async ({ page }) => {
  await page.goto('/?splittag_force=exp-hero-cta:urgency');
  await expect(page.locator('#hero-headline')).toHaveText(URGENCY_HEADLINE);
  await expect(page.locator('#cta-primary')).toHaveText(URGENCY_CTA);
  await expect(page.locator('#cta-primary')).toHaveCSS('background-color', URGENCY_BG);

  await page.goto('/?splittag_force=exp-hero-cta:control');
  await expect(page.locator('#hero-headline')).toHaveText(CONTROL_HEADLINE);
  await expect(page.locator('#cta-primary')).toHaveText(CONTROL_CTA);
  await expect(page.locator('#cta-primary')).toHaveCSS('background-color', CONTROL_BG);
});

test('force mode moves the lead form above benefits and hides testimonials', async ({ page }) => {
  await page.goto('/?splittag_force=exp-form-position:form-first');
  await expect(page.locator('#testimonials')).toBeHidden();
  const formBeforeBenefits = await page.evaluate(() => {
    const form = document.getElementById('lead-form-section');
    const benefits = document.getElementById('benefits');
    return Boolean(benefits.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_PRECEDING);
  });
  expect(formBeforeBenefits).toBe(true);
  await expect(page.locator('#lead-form')).toBeVisible();

  await page.goto('/?splittag_force=exp-form-position:control');
  await expect(page.locator('#testimonials')).toBeVisible();
  const formAfterBenefits = await page.evaluate(() => {
    const form = document.getElementById('lead-form-section');
    const benefits = document.getElementById('benefits');
    return Boolean(form.compareDocumentPosition(benefits) & Node.DOCUMENT_POSITION_PRECEDING);
  });
  expect(formAfterBenefits).toBe(true);
});
