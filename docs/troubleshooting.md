# Troubleshooting

## The page flashes the control before the variant

**Symptom:** a visitor briefly sees the control headline/CTA, then the page changes.

Check, in order:

1. **The snippet is not in `<head>`, or it is async/deferred.** The guard must
   run before the browser paints. Keep `<script src="/snippet.js"></script>` as a
   classic parser-blocking script before the stylesheet and before visible
   content. Never add `async` or `defer`.
2. **The config is not inline.** The inline path is synchronous. The
   `/api/config` fallback is still synchronous but adds a network round trip;
   on a slow connection the safety timer may reveal before the config arrives.
   Inject the running config into the page (the demo's Express route does this)
   or keep the server fast.
3. **A page-level stylesheet overrides the guard.** SplitTag injects
   `html { visibility: hidden !important }`; a rule that sets
   `visibility: visible !important` on `html` or a body child with higher
   specificity can defeat it. Check for `visibility`/`opacity` overrides.
4. **Changes target elements that do not exist at DOMContentLoaded.** This is
   not a flash if the page is still hidden; the MutationObserver retries for
   up to 2000 ms. If the target never appears, the variant cannot apply. Fix the
   selector rather than raising the window.
5. **A JavaScript error prevents reveal.** The 1000 ms safety timer reveals the
   page. Look for `[SplitTag]` warnings in the console and inspect
   `window.SplitTag._debug` (`revealReason`, `revealDelay`,
   `changesAppliedAt`).
6. **Caching.** Serve `snippet.js` with `Cache-Control: no-store` while
   iterating. The included Express server does; a CDN may not.

To reproduce the automated anti-flicker check locally:

```bash
npx playwright test tests/e2e/anti-flicker.spec.js --project=chromium --headed
```

The probe watches rAF, `readystatechange`, and DOM mutations, and asserts that
the control text is never visible. Measurements land in
`results/browser-matrix.md`.

## A selector stopped matching after a redeploy

**Symptom:** an experiment reports zero conversions, or the variant applies to
only some page states.

SplitTag records CSS selectors. `generateSelector()` prefers a unique `#id`,
then `data-testid`/`data-test`/`data-qa`/`data-cy`/`aria-label`/`name`, then a
class candidate, then an `:nth-of-type()` path. Consequences:

- Renaming an id or moving an element breaks an id-based change. Add a stable
  `data-testid` to the element and re-record the change.
- `:nth-of-type()` paths are the most fragile: adding a sibling changes the
  path. Re-pick the element after layout changes.
- Hiding a whole region with `#testimonials` is resilient to internal markup
  changes; replacing content inside it by a deep path is not.
- Class-based selectors can match a new element after a CSS refactor. Check
  that the selector is still unique in the editor's selector field before
  saving.

If a change targets every match, that is intentional: `text`, `html`, `class`,
and `attr` apply to all nodes matching the selector, while `move` uses the
first match. Narrow the selector if only one element should change.

To diagnose, open the editor, load the experiment, and inspect the JSON drawer.
The recorded changes are exactly what the snippet applies.

## How many visitors do I need?

The results view shows a required sample per arm and a progress bar. It is
computed with:

```text
n = ((z(1-α/2) · sqrt(2·p̄·(1-p̄)) + z(power) · sqrt(p1(1-p1) + p2(1-p2)))²) / (p2-p1)²
```

where `p1` is the control rate and `p2 = p1 + MDE`. Defaults are α = 0.05,
power = 0.8. The results engine uses the **observed absolute lift** as the MDE
(floored at 0.5 percentage points and 10% of the control rate) so the progress
bar answers “do I have enough data to detect the effect I am seeing?” rather
than “did I pre-register the right effect?”. For a real launch, choose the MDE
before starting and do not peek every day.

Rules of thumb:

- Lower baseline rates need more visitors for the same relative lift.
- Halving the detectable effect roughly quadruples the sample.
- 80% power means a 20% chance of missing a true effect of that size.
- A p-value is not the probability the variant is better; it is the probability
  of data this extreme if the variants were identical.
- The dashboard's decision is fixed-horizon. Repeated looks inflate false
  positives; use a sequential test or a pre-registered end date if you need
  early stopping.

If the dashboard says **KEEP RUNNING**, the per-arm visitor count is below the
required sample, even if the p-value already looks small. If it says
**NO-SHIP** after the sample is reached, the difference is either significantly
negative or flat enough that shipping is not justified.

## Force mode shows no events (expected)

`?splittag_force=exp:variant` sets `window.SplitTag.preview = true`, skips
writing `localStorage.splittag_assign`, and suppresses exposures and
conversions. This is intentional. To verify tracking, load the page without the
force parameter and inspect the network panel or `/api/events`.

## Playwright Firefox fails on macOS 27

Playwright's bundled Firefox cannot start from a direct exec on macOS 27
because its app-data directory is TCC-protected. The Playwright config detects
macOS and launches Firefox through
`tools/firefox-macos27-wrapper.sh`, which starts it with an explicit app
identity and disables the content sandbox for the local test run. This is a
development-only workaround; Linux CI launches Firefox normally. Chromium and
WebKit are unaffected.
