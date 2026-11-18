# Cross-browser and mobile test matrix

Generated: 2026-11-18T23:36:11.872Z

Produced by the custom Playwright reporter (`tests/e2e/reporter.js`) from a real `npm run test:e2e` run.

| Project | Browser | Viewport | Tests passed | Status | Reveal delay min | median | max |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: |
| chromium | chromium | 1280×720 (desktop) | 8/8 | PASS | 12.2 ms | 17.4 ms | 91.7 ms |
| firefox | firefox | 1280×720 (desktop) | 8/8 | PASS | 15.0 ms | 25.0 ms | 388.0 ms |
| webkit | webkit | 1280×720 (DPR 2) | 8/8 | PASS | 7.0 ms | 9.0 ms | 109.0 ms |
| Mobile Safari | webkit | 390×664 (mobile, DPR 3) | 8/8 | PASS | 9.0 ms | 10.0 ms | 66.0 ms |
| Pixel 7 | chromium | 412×839 (mobile, DPR 2.625) | 8/8 | PASS | 6.0 ms | 9.5 ms | 76.3 ms |

## Anti-flicker reveal delay

- Navigations measured: **25** (5 forced-variant reloads per browser/mobile project)
- Minimum: **6.0 ms**
- Median: **12.2 ms**
- Maximum: **388.0 ms**

Reveal delay is `window.SplitTag._debug.revealDelay`: from snippet execution to the
anti-flicker guard being removed, after variant mutations were applied. The control
headline was never observed painted in any sample (rAF, readystatechange, and
MutationObserver probes), and the body computed `visibility: hidden` at the
`interactive` readyState in every navigation.

## Suite totals

- E2E tests run: **40**
- Passed: **40**
- Failed: **0**

