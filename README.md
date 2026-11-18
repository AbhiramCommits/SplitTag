# SplitTag

SplitTag is a self-hosted, client-side A/B testing and conversion-tracking toolkit for marketing and landing pages. It covers the same workflow Optimizely and HubSpot experiments provide — a pre-paint variant decision, a visual editor that records DOM/CSS mutations, click/form/scroll conversion goals, and a results view with a two-proportion z-test and an explicit ship call — built from scratch in vanilla JavaScript, HTML, CSS, and Node/Express so every mechanic is inspectable. There is no framework, no TypeScript, and no build step.

---

## Quickstart

```bash
npm install
npm start
```

Then open:

| URL | What it is |
| --- | --- |
| http://localhost:4000/ | `FundMySemester` demo landing page with the snippet installed |
| http://localhost:4000/editor.html | Visual variant editor |
| http://localhost:4000/results.html | Results dashboard with the live stats engine |
| http://localhost:4000/snippet-loader.html | Two-line install reference |

Force a variant for QA (no events are recorded):

```
http://localhost:4000/?splittag_force=exp-hero-cta:urgency
http://localhost:4000/?splittag_force=exp-hero-cta:control
http://localhost:4000/?splittag_force=exp-form-position:form-first
```

### Re-run the committed experiment

The repository commits the real event log and the artifacts generated from it:

```bash
# 8,000 simulated visitors through the real bucketing code and real /api/events
node tools/simulate.js --experiment exp-hero-cta --visitors 8000 \
  --control-rate 0.082 --variant-rate 0.101 --seed 42

node tools/simulate.js --experiment exp-form-position --visitors 8000 \
  --control-rate 0.112 --variant-rate 0.094 --seed 42

# Recompute results/results.md and results/results.json from the event log
node tools/report.js
```

The simulator imports the same FNV-1a module used by the snippet, generates visitor ids, buckets them, rolls conversions with a seeded PRNG, batches real events to the API, and prints a summary. The committed log is `data/events.json`; the committed run output is `results/simulation-log.txt`.

### Tests

```bash
npm test          # node:test unit suite
npx playwright install chromium firefox webkit
npm run test:e2e  # 5 projects, 40 tests
```

---

## Install snippet

Paste these two lines into the page `<head>`, before the stylesheet and any visible content. The config line comes first; the snippet must stay a synchronous classic script (no `async`, no `defer`, no bundler).

```html
<script>window.SPLITTAG_CONFIG = {"experiments":[{"id":"exp-hero-cta","targetUrlPattern":"/","trafficAllocation":1,"variants":[{"id":"control","weight":0.5,"changes":[]},{"id":"urgency","weight":0.5,"changes":[]}],"goals":[{"id":"cta-click","type":"click","selector":"#cta-primary"}]}]};</script>
<script src="/snippet.js"></script>
```

The inline object is a minimal config: variant changes and goals only. If `window.SPLITTAG_CONFIG` is absent, the snippet falls back to a synchronous `GET /api/config`, but the inline path is the zero-latency path and the one the demo uses. `docs/install.md` has the full install and QA notes.

---

## Architecture

```
        editor.html / editor.js                    index.html
        (visual WYSIWYG)                 inline config + snippet.js (sync, in <head>)
               |                                        |
               | GET/POST/DELETE                        | FNV-1a local decision
               | /api/experiments                       | DOM/CSS mutations, reveal
               v                                        v
        +------------------ Express (server/index.js) ------------------+
        |  /api/config   /api/experiments   /api/events   /api/results  |
        +------------------+------------------------+-------------------+
                           |                        ^
                           v                        | sendBeacon / fetch
                  server/store.js                  |
                  data/experiments.json      snippet tracker
                  data/events.json           (click, form, scroll)
                           |
                  server/stats.js (pure)
                  aggregate + z-test + decision
                           ^
                           |
          tools/report.js / results.html    tools/simulate.js
                                            imports shared/bucketing.js
```

| File | Responsibility |
| --- | --- |
| `public/snippet.js` | One classic synchronous IIFE: anti-flicker guard, visitor id, config (inline or sync fallback), FNV-1a bucketing, sticky assignment, DOM/CSS mutation, bounded MutationObserver retries, tracking, exposure, public `window.SplitTag` API. |
| `public/tracking.js` | Standalone, readable tracker reference with delegated clicks, capture-phase submits, programmatic submits, throttled monotonic scroll depth, batching, and `sendBeacon`/`fetch(keepalive)` transport. |
| `public/editor.html`, `public/editor.js`, `public/editor.css` | Vanilla ES-module visual editor: experiment/variant/goal panels, iframe WYSIWYG picker, text/HTML/style/class/hide/move/attr actions, JSON inspector, save and preview. |
| `public/selector.js` | `generateSelector()` (unique id → data attribute → class → nth-of-type path) and the shared mutation applier. |
| `public/results.html`, `public/results.js`, `public/results.css` | Experiment picker, variant table, CSS bar chart with confidence whiskers, sample progress, SHIP/NO-SHIP/KEEP RUNNING badge. |
| `server/index.js` | Express static host and API: config, experiment CRUD, batched events, results, validation errors as HTTP 400. |
| `server/store.js` | Schema validation and atomic JSON persistence (temp file + rename). |
| `server/stats.js` | Pure stats: aggregation, `normalCdf`, z-test, lift CI, `requiredSampleSize`, `decide`, `computeResults`. |
| `shared/bucketing.js` | Canonical FNV-1a bucketing and weighted variant selection, imported by the simulator and mirrored by the snippet. |
| `tools/simulate.js` | Seeded traffic simulator that drives the real bucketing code and POSTs real events. |
| `tools/report.js` | Fetches every `/api/results/:id` and writes `results/results.md` + `results/results.json`. |
| `tests/unit/` | `node:test` suites for bucketing, selector generation, stats, schema, and dedupe. |
| `tests/e2e/` | Playwright specs, fixtures, anti-flicker probe, and the custom matrix reporter. |
| `playwright.config.js` | chromium, firefox, webkit, Mobile Safari (iPhone 13), and Pixel 7 projects; boots the server with isolated test data. |
| `.github/workflows/ci.yml` | Node 20, `npm ci`, Playwright browser install, unit + e2e tests, report artifact. |

---

## How it works

### Anti-flicker strategy

The snippet is parser-blocking in `<head>` and its first action injects `html { visibility: hidden !important }`. It makes the variant decision locally, waits for the initial DOM to exist, applies text/HTML/class/move/attribute changes and injects style/hide rules into a scoped `<style>` tag, then removes the guard inside a `requestAnimationFrame`. A 1000 ms safety timer always reveals the page if config loading or mutation throws, and a MutationObserver retries missing targets for a bounded 2000 ms window.

The measured reveal delay (from snippet execution to guard removal) across 25 navigations was **min 6.0 ms, median 12.2 ms, max 388.0 ms**. The probe never observed the control headline while visible, and the body computed `visibility: hidden` at the `interactive` readyState on every run. Details: `results/browser-matrix.md`.

### Deterministic FNV-1a bucketing, with no server call

`fnv1a32(visitorId + ":" + experimentId)` returns an unsigned 32-bit hash; dividing by 2³² gives a stable value in `[0, 1)`. That value gates traffic allocation. A second value is derived from the same hash (`Math.imul(hash, 0x9e3779b1) >>> 0`) so admitted visitors are not biased into the first half of a weighted range. Variant choice is a cumulative-weight walk over that second value. Because everything is local and deterministic, the first paint needs no network round trip, and the same visitor gets the same answer on every page and every session.

The snippet embeds this implementation so the two-line install is self-contained; the demo also loads `shared/bucketing.js`, and a unit test compares the embedded hash function against the shared module for sample inputs.

### Sticky assignment

Assignments live in `localStorage.splittag_assign` as `{ experimentId: variantId }`. A stored assignment wins over any weight or traffic change, so changing a variant's weight never reshuffles an existing visitor. Forced QA assignments are not persisted.

### Selector generation

The editor prefers, in order: a unique `#id`, a unique stable attribute (`data-testid`, `data-test`, `data-qa`, `data-cy`, `aria-label`, `name`), a unique tag + class combination, then a tag/`:nth-of-type()` path from the nearest uniquely identifiable ancestor. `tests/unit/selector.test.js` resolves every generated selector back to the original element in a fixture DOM, including duplicate ids and repeated benefit cards.

### Per-visitor conversion dedupe

Tracking is deduped twice. The browser writes a `splittag_goal_<experimentId>_<goalId>` marker after firing, so a double-click or repeat submit does not requeue the event. The server-side aggregation counts unique `visitorId`s per goal, so even duplicate events that arrive from different pages count once. `computeResults` reports one converting visitor per goal; the overall variant conversion count is the union of converting visitors across goals.

### QA force mode

`?splittag_force=<experimentId>:<variantId>` (or `:control`) overrides assignment for that experiment. It sets `window.SplitTag.preview = true`, does not write the sticky assignment, and suppresses every event send including exposures. The `/api/config` and demo HTML include non-running experiments when a force parameter is present, so draft variants can be inspected before launch.

---

## Experiment catalog

| Experiment | Hypothesis | Control | Variant | Goals |
| --- | --- | --- | --- | --- |
| `exp-hero-cta` | Deadline urgency + a red CTA increases eligibility clicks versus the neutral teal CTA. | Original headline, “Check My Eligibility”, teal `#0f766e` CTA. | “Scholarship deadlines are closing. Claim your match before the semester starts.”, “Get My Scholarship Match Now”, CTA background `#dc2626`. | `cta-click`: click on `#cta-primary`. |
| `exp-form-position` | Putting the lead form above the benefit cards and removing the testimonial block reduces distraction and increases lead submits. | Form after benefits, testimonials visible. | `#lead-form-section` moved before `#benefits`; `#testimonials` hidden. | `form-submit`: submit `#lead-form`; `scroll-75`: scroll depth 75%. |

Both experiment configs are committed as `seeds/exp-hero-cta.json` and `seeds/exp-form-position.json`, and in `data/experiments.json`. The editor's Save button posts exactly this schema to `POST /api/experiments`, and its JSON drawer shows the recorded config before saving; the committed configs are the inputs the editor loads and edits.

---

## RESULTS

All figures below come from the committed event log (`data/events.json`), the live stats engine (`GET /api/results/:id`), the committed simulator log (`results/simulation-log.txt`), the committed report (`results/results.md`), and a real local Playwright run (`results/browser-matrix.md`). Re-running the simulator with the same seed and experimenting with the same ids reproduces the bucket assignments; conversion rolls are seeded per experiment.

### `exp-hero-cta` — urgency vs control

8,000 synthetic visitors, 4,017 control / 3,983 urgency. Goal: unique visitor clicking `#cta-primary`.

| Variant | Visitors | Conversions | Conversion rate | Lift vs control | 95% CI (relative lift) | p-value |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Control | 4,017 | 327 | **8.14%** | — | — | — |
| Urgency | 3,983 | 430 | **10.80%** | **+32.62%** | **+16.87% to +48.37%** | **0.0000497** |

- Absolute lift: **+2.66 percentage points**
- z-score: **4.0573**
- Required sample: **1,907 per arm** (α = 0.05, power = 0.8, MDE = 2.66 percentage points)
- Sample progress: **100.0%**
- **Decision: SHIP** — “Urgency lifts conversion by 32.62% (8.14% → 10.80%, p<0.0001) on 4,017 control and 3,983 variant visitors, with the required 1,907 per arm reached — ship it.”

The simulator requested 8.20% control / 10.10% variant. The committed log rolled 8.14% and 10.80%; the seeded PRNG therefore produced a slightly hotter variant than configured, and the reported 32.62% lift is the measured result, not the configured input.

### `exp-form-position` — form first vs control

8,000 synthetic visitors, 4,043 control / 3,957 form-first. Primary goal: unique visitor submitting `#lead-form`.

| Variant | Visitors | Conversions | Conversion rate | Lift vs control | 95% CI (relative lift) | p-value |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Control | 4,043 | 454 | **11.23%** | — | — | — |
| Form first | 3,957 | 353 | **8.92%** | **−20.56%** | **−32.29% to −8.82%** | **0.0006089** |

- Absolute lift: **−2.31 percentage points**
- z-score: **−3.4276**
- Required sample: **3,196 per arm** (α = 0.05, power = 0.8, MDE = 2.31 percentage points)
- Sample progress: **100.0%**
- **Decision: NO-SHIP** — “Form first reduces conversion by 20.56% (11.23% → 8.92%, p=0.0006) on 4,043 control and 3,957 variant visitors — keep the control.”

The secondary scroll-depth goal (`scroll-75`) recorded 0 conversions in both arms because the simulator models the primary goal only; the real tracking implementation and its browser test cover scroll depth.

### Anti-flicker and cross-browser matrix

Each project ran 8 tests; the anti-flicker test alone performs 5 forced-variant navigations and records `window.SplitTag._debug.revealDelay`.

| Project | Browser | Viewport | Tests passed | Status | Reveal min | median | max |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: |
| chromium | chromium | 1280×720 desktop | 8/8 | PASS | 12.2 ms | 17.4 ms | 91.7 ms |
| firefox | firefox | 1280×720 desktop | 8/8 | PASS | 15.0 ms | 25.0 ms | 388.0 ms |
| webkit | webkit | 1280×720 desktop | 8/8 | PASS | 7.0 ms | 9.0 ms | 109.0 ms |
| Mobile Safari | webkit | 390×664 mobile | 8/8 | PASS | 9.0 ms | 10.0 ms | 66.0 ms |
| Pixel 7 | chromium | 412×839 mobile | 8/8 | PASS | 6.0 ms | 9.5 ms | 76.3 ms |

Across all **25** measured navigations: **min 6.0 ms, median 12.2 ms, max 388.0 ms**. The control headline was never observed painted, and `document.body` computed `visibility: hidden` at the `interactive` readyState before mutations were applied.

### Test counts

- Unit tests: **28 passed, 0 failed** (`npm test`).
- E2E tests: **40 passed, 0 failed** (`npm run test:e2e`, 5 projects × 8 tests).
- CI: Node 20, unit suite then e2e suite, Playwright HTML report uploaded as an artifact.

### Snippet size

Measured from `public/snippet.js`:

- Raw: **24,114 bytes** (23.5 KiB)
- Gzipped (`gzip -9`): **6,867 bytes** (6.7 KiB)

The size includes the embedded fallback bucketing and the bundled tracker so the install stays two lines.

### Bucketing distribution accuracy

From the 100,000-id unit test (`results/bucketing-distribution.json`), configured weights 50% / 30% / 20%:

| Variant | Configured | Observed | Delta |
| --- | ---: | ---: | ---: |
| control | 50.0% | **49.916%** | −0.084 pp |
| urgency | 30.0% | **30.017%** | +0.017 pp |
| social-proof | 20.0% | **20.067%** | +0.067 pp |

All three are inside the test's ±1.5 percentage-point tolerance; the largest deviation is 0.084 pp.

---

## Limitations and what I would do next

- **Client-side only.** A visitor with JavaScript disabled, a blocked request, or a cleared `localStorage` is not tracked. A server-side decision endpoint with signed assignments would close that gap.
- **JSON files, single process.** Writes are atomic, but the store is not safe for multiple API instances or high event volume. A real datastore (Postgres events + a materialized results table) and idempotency keys are the next step.
- **No authentication.** The editor and API are open on localhost. A self-hosted deployment needs auth, CSRF protection, and per-project scoping before exposure to a network.
- **Peeking is not corrected.** The decision is a fixed-horizon z-test; checking results daily inflates false positives. Sequential/always-valid p-values or a group-sequential design would make early stopping defensible.
- **The planning MDE uses the observed lift.** `requiredSampleSize` is evaluated from the observed absolute difference (floored at 0.5 pp and 10% of the control rate). That makes “past the required sample” a practical progress indicator, not a pre-registered plan. A production workflow should register the MDE before launch.
- **Two variants at a time.** The editor and results view handle multiple variants, but the decision logic compares the first treatment to control. Multi-armed bandits or a Bayesian hierarchical model would allocate traffic adaptively and avoid the multiple-comparison penalty.
- **Selector drift.** Changes are recorded as CSS selectors. A redeployed page can break them; the 2000 ms retry window helps only with late-rendered nodes, not renamed ids. A semantic element-reference layer or server-side rendering of variants would be more durable.
- **Experiment interactions.** A visitor is independently bucketed into both running experiments on `/`; there is no mutual-exclusion layer. A production tool needs experiment collision rules.
- **Firefox on macOS 27.** Playwright's bundled Firefox cannot launch from a direct exec on macOS 27 because its app-data directory is TCC-protected. `tools/firefox-macos27-wrapper.sh` starts it with an explicit app identity and disabled content sandbox for local runs; CI runs Firefox normally on Linux. The wrapper is a development workaround, not production code.
