# SplitTag experiment results

Generated: 2026-11-18T23:40:49.421Z

These numbers are generated from the committed event log through the live stats engine
(`GET /api/results/:id`). Regenerate with `node tools/report.js`.

## Hero CTA: urgency vs control (`exp-hero-cta`)

**Decision: SHIP**

Urgency lifts conversion by 32.62% (8.14% → 10.80%, p<0.0001) on 4,017 control and 3,983 variant visitors, with the required 1,907 per arm reached — ship it.

| Variant | Visitors | Conversions | Conversion rate | Lift vs control | 95% CI (lift) | p-value |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Control (control) | 4,017 | 327 | 8.14% | — | — | — |
| Urgency | 3,983 | 430 | 10.80% | +32.62% | +16.87% to +48.37% | <0.0001 |

- Control conversion rate: **8.14%** (327/4,017)
- Variant conversion rate: **10.80%** (430/3,983)
- Absolute lift: **+2.66%**; relative lift: **+32.62%**
- 95% CI for relative lift: **+16.87% to +48.37%**
- Two-tailed p-value: **<0.0001**; z = 4.0573
- Required sample: **1,907 per arm** at α=0.05, power=0.8, MDE=2.66%
- Sample progress: **100.0%** of the planned per-arm sample
- Exposed visitors total: **8,000**

### Goals

| Goal | Type | Control conversions | Variant conversions |
| --- | --- | ---: | ---: |
| Primary CTA click | click | 327 (8.14%) | 430 (10.80%) |

## Lead form above benefits (`exp-form-position`)

**Decision: NO-SHIP**

Form first reduces conversion by 20.56% (11.23% → 8.92%, p=0.0006) on 4,043 control and 3,957 variant visitors — keep the control.

| Variant | Visitors | Conversions | Conversion rate | Lift vs control | 95% CI (lift) | p-value |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Control (control) | 4,043 | 454 | 11.23% | — | — | — |
| Form first | 3,957 | 353 | 8.92% | -20.56% | -32.29% to -8.82% | 0.0006 |

- Control conversion rate: **11.23%** (454/4,043)
- Variant conversion rate: **8.92%** (353/3,957)
- Absolute lift: **-2.31%**; relative lift: **-20.56%**
- 95% CI for relative lift: **-32.29% to -8.82%**
- Two-tailed p-value: **0.0006**; z = -3.4276
- Required sample: **3,196 per arm** at α=0.05, power=0.8, MDE=2.31%
- Sample progress: **100.0%** of the planned per-arm sample
- Exposed visitors total: **8,000**

### Goals

| Goal | Type | Control conversions | Variant conversions |
| --- | --- | ---: | ---: |
| Lead form submit | form_submit | 454 (11.23%) | 353 (8.92%) |
| Read to 75% | scroll_depth | 0 (0.00%) | 0 (0.00%) |

