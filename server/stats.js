/**
 * Pure statistics for SplitTag experiments. No I/O and no dependencies.
 * @module server/stats
 */

const Z_95 = 1.959963984540054;

/**
 * Error function, Abramowitz & Stegun 7.1.26 (max abs error 1.5e-7).
 * @param {number} x
 * @returns {number}
 */
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
    0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Standard normal cumulative distribution.
 * @param {number} z
 * @returns {number} probability in [0, 1]
 */
export function normalCdf(z) {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Inverse standard normal CDF (Acklam's rational approximation with one
 * Newton refinement step). Used only for planning sample sizes.
 * @param {number} p probability in (0, 1)
 * @returns {number} z such that normalCdf(z) ≈ p
 */
export function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const low = 0.02425;
  const high = 1 - low;
  let q;
  let r;
  let x;

  if (p < low) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > high) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    q = p - 0.5;
    r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // One Halley refinement keeps the tail accurate.
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/**
 * 95% confidence interval for a single proportion (normal approximation).
 * @param {number} conversions
 * @param {number} visitors
 * @returns {[number, number]}
 */
export function proportionCI95(conversions, visitors) {
  if (!visitors || visitors <= 0) return [0, 0];
  const p = conversions / visitors;
  const margin = Z_95 * Math.sqrt((p * (1 - p)) / visitors);
  return [Math.max(0, p - margin), Math.min(1, p + margin)];
}

/**
 * Two-proportion z-test with a pooled standard error.
 * @param {number} controlConv
 * @param {number} controlN
 * @param {number} variantConv
 * @param {number} variantN
 * @returns {{
 *   zScore: number,
 *   pValue: number,
 *   lift: number,
 *   liftCI95: [number, number],
 *   diffCI95: [number, number],
 *   significant: boolean
 * }}
 */
export function twoProportionZTest(controlConv, controlN, variantConv, variantN) {
  if (!controlN || !variantN || controlN <= 0 || variantN <= 0) {
    return { zScore: 0, pValue: 1, lift: 0, liftCI95: [0, 0], diffCI95: [0, 0], significant: false };
  }
  const p1 = controlConv / controlN;
  const p2 = variantConv / variantN;
  const pooled = (controlConv + variantConv) / (controlN + variantN);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / controlN + 1 / variantN));
  const zScore = sePooled === 0 ? 0 : (p2 - p1) / sePooled;
  const pValue = Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(zScore)))));

  const diff = p2 - p1;
  const seUnpooled = Math.sqrt((p1 * (1 - p1)) / controlN + (p2 * (1 - p2)) / variantN);
  const diffCI95 = [diff - Z_95 * seUnpooled, diff + Z_95 * seUnpooled];
  const lift = p1 > 0 ? diff / p1 : 0;
  const liftCI95 = p1 > 0
    ? [diffCI95[0] / p1, diffCI95[1] / p1]
    : [0, 0];

  return {
    zScore,
    pValue,
    lift,
    liftCI95,
    diffCI95,
    significant: pValue < 0.05
  };
}

/**
 * Visitors needed per arm to detect an absolute effect at the requested
 * significance and power (two-sided).
 * @param {number} baselineRate control conversion rate, 0..1
 * @param {number} minDetectableEffect absolute change, e.g. 0.01
 * @param {number} [alpha=0.05]
 * @param {number} [power=0.8]
 * @returns {number} visitors per arm, or Infinity for a zero effect
 */
export function requiredSampleSize(baselineRate, minDetectableEffect, alpha = 0.05, power = 0.8) {
  if (!(minDetectableEffect > 0)) return Infinity;
  const p1 = Math.min(0.9999, Math.max(0.0001, baselineRate));
  const p2 = Math.min(0.9999, Math.max(0.0001, baselineRate + minDetectableEffect));
  if (p1 === p2) return Infinity;
  const pBar = (p1 + p2) / 2;
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);
  const numerator = Math.pow(
    zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) +
    zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)),
    2
  );
  const denominator = Math.pow(p2 - p1, 2);
  const n = numerator / denominator;
  return Number.isFinite(n) ? Math.ceil(n) : Infinity;
}

/**
 * Aggregate an experiment's events into per-variant unique-visitor counts.
 * Exposure events establish the denominator; a visitor converting a goal
 * counts once no matter how many times the goal fires.
 * @param {object[]} events
 * @param {object} experiment
 * @returns {object}
 */
export function aggregate(events, experiment) {
  const wanted = new Map();
  for (const variant of experiment.variants) {
    wanted.set(variant.id, {
      id: variant.id,
      name: variant.name,
      weight: variant.weight,
      isControl: variant === experiment.variants[0],
      exposed: new Set(),
      goalVisitors: new Map(experiment.goals.map((goal) => [goal.id, new Set()])),
      allGoalVisitors: new Set()
    });
  }

  for (const event of events || []) {
    if (!event || (event.experimentId && event.experimentId !== experiment.id)) continue;
    const variant = wanted.get(event.variantId);
    if (!variant || !event.visitorId) continue;
    if (event.type === 'exposure') {
      variant.exposed.add(event.visitorId);
    } else if (event.type === 'goal' && event.goalId) {
      if (!variant.goalVisitors.has(event.goalId)) variant.goalVisitors.set(event.goalId, new Set());
      variant.goalVisitors.get(event.goalId).add(event.visitorId);
      variant.allGoalVisitors.add(event.visitorId);
    }
  }

  const variants = experiment.variants.map((variantConfig) => {
    const data = wanted.get(variantConfig.id);
    const goalUnion = data.allGoalVisitors;
    const denominator = data.exposed.size > 0 ? data.exposed : goalUnion;
    const visitors = denominator.size;
    const conversions = [...goalUnion].filter((id) => denominator.has(id)).length;
    const goalStats = experiment.goals.map((goal) => {
      const set = data.goalVisitors.get(goal.id) || new Set();
      const count = [...set].filter((id) => denominator.has(id)).length;
      return {
        goalId: goal.id,
        name: goal.name,
        type: goal.type,
        conversions: count,
        conversionRate: visitors > 0 ? count / visitors : 0
      };
    });
    return {
      id: variantConfig.id,
      name: variantConfig.name,
      weight: variantConfig.weight,
      isControl: variantConfig === experiment.variants[0],
      visitors,
      exposures: visitors,
      conversions,
      conversionRate: visitors > 0 ? conversions / visitors : 0,
      rateCI95: proportionCI95(conversions, visitors),
      goals: goalStats
    };
  });

  return {
    experimentId: experiment.id,
    variants,
    totalVisitors: variants.reduce((sum, variant) => sum + variant.visitors, 0),
    goals: experiment.goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      type: goal.type,
      variants: variants.map((variant) => {
        const stat = variant.goals.find((item) => item.goalId === goal.id);
        return {
          variantId: variant.id,
          conversions: stat ? stat.conversions : 0,
          conversionRate: stat ? stat.conversionRate : 0,
          visitors: variant.visitors
        };
      })
    }))
  };
}

/**
 * Make the SHIP / NO-SHIP / KEEP RUNNING call.
 * @param {object} result a result object containing `variants`, `test`,
 *   `requiredSampleSize`, and visitor counts
 * @returns {'SHIP'|'NO-SHIP'|'KEEP RUNNING'}
 */
export function decide(result) {
  const variants = result && result.variants ? result.variants : [];
  const control = variants.find((variant) => variant.isControl) || variants[0];
  const treatment = variants.find((variant) => variant && !variant.isControl) || variants[1];
  if (!control || !treatment) return 'KEEP RUNNING';
  const test = result.test || treatment.test || {};
  const required = Number.isFinite(result.requiredSampleSize)
    ? result.requiredSampleSize
    : treatment.visitors;
  const perArm = Math.min(control.visitors, treatment.visitors);
  if (required > 0 && perArm < required) return 'KEEP RUNNING';
  if (test.significant && Number(test.lift) > 0) return 'SHIP';
  return 'NO-SHIP';
}

/**
 * Human-readable one-sentence explanation for a decision.
 * @param {object} result result object from {@link computeResults}
 * @param {'SHIP'|'NO-SHIP'|'KEEP RUNNING'} [decision]
 * @returns {string}
 */
export function explainDecision(result, decision = decide(result)) {
  const variants = result.variants || [];
  const control = variants.find((variant) => variant.isControl) || variants[0];
  const treatment = variants.find((variant) => variant && !variant.isControl) || variants[1];
  if (!control || !treatment) return 'There are not enough variants to make a call yet.';
  const pct = (value) => `${(value * 100).toFixed(2)}%`;
  const test = result.test || {};
  const p = Number.isFinite(test.pValue) ? test.pValue : 1;
  const pText = p < 0.0001 ? '<0.0001' : p.toFixed(4);
  const pLabel = pText.startsWith('<') ? `p${pText}` : `p=${pText}`;
  const arm = `${control.visitors.toLocaleString('en-US')} control and ${treatment.visitors.toLocaleString('en-US')} variant visitors`;
  const required = Number.isFinite(result.requiredSampleSize)
    ? result.requiredSampleSize.toLocaleString('en-US')
    : 'an undetermined number of';
  const liftPct = Number.isFinite(test.lift) ? (test.lift * 100).toFixed(2) : '0.00';

  if (decision === 'SHIP') {
    return `${treatment.name} lifts conversion by ${liftPct}% (${pct(control.conversionRate)} → ${pct(treatment.conversionRate)}, ${pLabel}) on ${arm}, with the required ${required} per arm reached — ship it.`;
  }
  if (decision === 'NO-SHIP') {
    if (test.significant && test.lift < 0) {
      return `${treatment.name} reduces conversion by ${Math.abs(Number(liftPct))}% (${pct(control.conversionRate)} → ${pct(treatment.conversionRate)}, ${pLabel}) on ${arm} — keep the control.`;
    }
    if (test.significant) {
      return `${treatment.name} shows a statistically significant but non-positive lift of ${liftPct}% (${pLabel}) on ${arm} — keep the control.`;
    }
    return `After ${arm} the difference is not statistically significant (${pct(control.conversionRate)} vs ${pct(treatment.conversionRate)}, ${pLabel}) — keep the control rather than ship a flat result.`;
  }
  const behind = Math.max(0, (Number.isFinite(result.requiredSampleSize) ? result.requiredSampleSize : 0) - Math.min(control.visitors, treatment.visitors));
  return `Only ${Math.min(control.visitors, treatment.visitors).toLocaleString('en-US')} visitors per arm so far; about ${behind.toLocaleString('en-US')} more per arm are needed to detect the observed ${Number.isFinite(test.lift) ? liftPct : '0.00'}% lift at 80% power — keep running.`;
}

/**
 * Build the full result payload consumed by /api/results/:id and the report.
 * @param {object} experiment
 * @param {object[]} events
 * @param {{alpha?: number, power?: number, mde?: number}} [options]
 * @returns {object}
 */
export function computeResults(experiment, events, options = {}) {
  const alpha = options.alpha === undefined ? 0.05 : options.alpha;
  const power = options.power === undefined ? 0.8 : options.power;
  const aggregated = aggregate(events, experiment);
  const control = aggregated.variants[0];
  const treatment = aggregated.variants[1] || null;
  const controlRate = control ? control.conversionRate : 0;
  const treatmentRate = treatment ? treatment.conversionRate : 0;
  const observedDiff = Math.abs(treatmentRate - controlRate);
  const mde = options.mde !== undefined
    ? options.mde
    : Math.max(observedDiff, controlRate * 0.1, 0.005);
  const required = requiredSampleSize(controlRate || 0.01, mde, alpha, power);

  const variants = aggregated.variants.map((variant) => {
    if (variant.isControl || !control) {
      return { ...variant, lift: 0, liftCI95: [0, 0], pValue: null, zScore: null, significant: false };
    }
    const test = twoProportionZTest(
      control.conversions, control.visitors,
      variant.conversions, variant.visitors
    );
    return { ...variant, ...test };
  });

  const treatmentResult = variants.find((variant) => !variant.isControl) || null;
  const test = treatmentResult
    ? {
      zScore: treatmentResult.zScore,
      pValue: treatmentResult.pValue,
      lift: treatmentResult.lift,
      liftCI95: treatmentResult.liftCI95,
      diffCI95: treatmentResult.diffCI95,
      significant: treatmentResult.significant
    }
    : { zScore: 0, pValue: 1, lift: 0, liftCI95: [0, 0], diffCI95: [0, 0], significant: false };

  const perArm = treatmentResult
    ? Math.min(control.visitors, treatmentResult.visitors)
    : control ? control.visitors : 0;
  const sampleProgress = Number.isFinite(required) && required > 0
    ? Math.min(1, perArm / required)
    : 0;

  const result = {
    experiment: {
      id: experiment.id,
      name: experiment.name,
      status: experiment.status,
      targetUrlPattern: experiment.targetUrlPattern,
      trafficAllocation: experiment.trafficAllocation
    },
    generatedAt: new Date().toISOString(),
    variants,
    goals: aggregated.goals,
    test,
    controlVariantId: control ? control.id : null,
    primaryVariantId: treatmentResult ? treatmentResult.id : null,
    totalVisitors: aggregated.totalVisitors,
    requiredSampleSize: required,
    minimumDetectableEffect: mde,
    sampleProgress,
    alpha,
    power
  };
  result.decision = decide(result);
  result.reason = explainDecision(result, result.decision);
  return result;
}
