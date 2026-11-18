/**
 * Deterministic bucketing shared by the browser snippet, the traffic
 * simulator, and the unit tests.
 *
 * This file is written so it can be loaded either as a classic script
 * (`<script src="/shared/bucketing.js">`) or imported from Node for its side
 * effect (`import '../shared/bucketing.js'`). It deliberately has no static
 * `export` statements, which would break the classic-script path.
 *
 * The hash is 32-bit FNV-1a. It is not cryptographic; it only needs to be
 * stable, fast, and uniformly distributed for the same visitor/experiment.
 */

(function attach(root) {
  'use strict';

  /**
   * 32-bit FNV-1a string hash.
   * @param {string} input
   * @returns {number} unsigned 32-bit integer
   */
  function fnv1a32(input) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      // 0x01000193 is the FNV prime; Math.imul keeps 32-bit multiplication.
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /**
   * Map a visitor + experiment pair to a stable number in [0, 1).
   * @param {string} visitorId
   * @param {string} experimentId
   * @returns {number}
   */
  function unitFor(visitorId, experimentId) {
    return fnv1a32(visitorId + ':' + experimentId) / 4294967296;
  }

  /**
   * Derive a second independent value from the same FNV hash for weighted
   * variant selection. Reusing the raw allocation value would bias the choice
   * (everyone admitted below a 50% traffic cutoff would land in the first
   * half of the weight range).
   * @param {string} visitorId
   * @param {string} experimentId
   * @returns {number}
   */
  function variantUnitFor(visitorId, experimentId) {
    var hash = fnv1a32(visitorId + ':' + experimentId);
    return (Math.imul(hash, 0x9e3779b1) >>> 0) / 4294967296;
  }

  /**
   * Pick a variant id by weight.
   * @param {Array<{id: string, weight: number}>} variants
   * @param {number} unit value in [0, 1)
   * @returns {string|null}
   */
  function pickVariant(variants, unit) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    var total = 0;
    for (var i = 0; i < variants.length; i += 1) {
      total += Math.max(0, Number(variants[i].weight) || 0);
    }
    if (total <= 0) return variants[0] ? variants[0].id : null;
    var target = unit * total;
    var cumulative = 0;
    for (var j = 0; j < variants.length; j += 1) {
      cumulative += Math.max(0, Number(variants[j].weight) || 0);
      if (target < cumulative) return variants[j].id;
    }
    return variants[variants.length - 1].id;
  }

  /**
   * Full admission + variant decision for one experiment.
   * @param {string} visitorId
   * @param {string} experimentId
   * @param {Array<{id: string, weight: number}>} variants
   * @param {number} trafficAllocation 0..1
   * @returns {{admitted: boolean, variantId: string|null, allocationUnit: number, variantUnit: number}}
   */
  function assignVariant(visitorId, experimentId, variants, trafficAllocation) {
    var allocationUnit = unitFor(visitorId, experimentId);
    var variantUnit = variantUnitFor(visitorId, experimentId);
    if (allocationUnit >= trafficAllocation) {
      return { admitted: false, variantId: null, allocationUnit: allocationUnit, variantUnit: variantUnit };
    }
    return {
      admitted: true,
      variantId: pickVariant(variants, variantUnit),
      allocationUnit: allocationUnit,
      variantUnit: variantUnit
    };
  }

  var api = {
    fnv1a32: fnv1a32,
    unitFor: unitFor,
    variantUnitFor: variantUnitFor,
    pickVariant: pickVariant,
    assignVariant: assignVariant
  };

  root.SplitTagBucketing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
