/*!
 * SplitTag snippet v1.0.0
 * One synchronous classic script. Put it in <head> before any content paints.
 *
 * The script hides the document immediately, assigns a variant with a local
 * FNV-1a hash (no network round trip), applies the variant's DOM/CSS changes,
 * then reveals the page. A safety timer always reveals the page even if
 * everything else throws.
 */
(function splitTagSnippet() {
  'use strict';

  var VERSION = '1.0.0';
  var CONFIG_ENDPOINT = '/api/config';
  var ASSIGN_KEY = 'splittag_assign';
  var VISITOR_KEY = 'splittag_vid';
  var VISITOR_COOKIE = 'splittag_vid';
  var DEFAULT_SAFETY_MS = 1000;
  var MUTATION_WINDOW_MS = 2000;
  var BATCH_DELAY_MS = 350;

  var startedAt = now();
  var cfg = null;
  var editorMode = /(?:^\?|&)splittag_editor=1(?:&|$)/.test(location.search);
  var force = parseForce();
  var preview = Boolean(force);
  var visitorId = null;
  var assignments = {};
  var experiments = {};
  var allGoals = [];
  var queue = [];
  var flushTimer = null;
  var goalMemory = {};
  var revealed = false;
  var revealedAt = null;
  var changesAppliedAt = null;
  var safetyTimer = null;
  var observer = null;
  var pendingChanges = [];
  var mutationDeadline = 0;
  var debug = {
    startedAt: startedAt,
    revealedAt: null,
    changesAppliedAt: null,
    revealDelay: null,
    revealReason: null,
    forced: Boolean(force),
    visitorId: null,
    experiments: []
  };

  var B = window.SplitTagBucketing || embeddedBucketing();

  var guardStyle = installAntiFlickerGuard();
  safetyTimer = setTimeout(function () { reveal('safety-timeout'); }, DEFAULT_SAFETY_MS);

  if (editorMode) {
    preview = true;
    reveal('editor-mode');
    exposeApi();
    return;
  }

  try {
    cfg = resolveConfig();
    if (!cfg || !Array.isArray(cfg.experiments)) cfg = { experiments: [] };
    visitorId = resolveVisitorId();
    debug.visitorId = visitorId;

    decideAssignments();
    debug.experiments = Object.keys(assignments);

    installTracking();
    registerReadyHandler();

    if (force && Object.keys(assignments).length > 0) preview = true;
    exposeApi();
  } catch (err) {
    // Never leave the page hidden because of a bad config or blocked storage.
    if (window.console && console.warn) console.warn('[SplitTag] init failed:', err);
    reveal('error');
    exposeApi();
  }

  /* ------------------------------------------------------------------ */
  /* Config and identity                                                 */
  /* ------------------------------------------------------------------ */

  function resolveConfig() {
    // Inline config (window.SPLITTAG_CONFIG) is the zero-latency path: the
    // decision is made in the same parse task, with no request before paint.
    // The synchronous XHR exists only as a fallback for pages that cannot
    // inline the config; it is intentionally last and never the default.
    if (window.SPLITTAG_CONFIG && Array.isArray(window.SPLITTAG_CONFIG.experiments)) {
      return window.SPLITTAG_CONFIG;
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', CONFIG_ENDPOINT + location.search, false);
      xhr.timeout = 800;
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300) return JSON.parse(xhr.responseText);
    } catch (err) {
      // fall through to an empty config; the page still reveals.
    }
    return { experiments: [] };
  }

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i += 1) {
      var eq = parts[i].indexOf('=');
      if (eq > -1 && parts[i].slice(0, eq) === name) {
        return decodeURIComponent(parts[i].slice(eq + 1));
      }
    }
    return null;
  }

  function writeCookie(name, value) {
    try {
      document.cookie = name + '=' + encodeURIComponent(value) +
        '; Max-Age=31536000; Path=/; SameSite=Lax';
    } catch (err) { /* cookies disabled */ }
  }

  function resolveVisitorId() {
    var fromCookie = readCookie(VISITOR_COOKIE);
    var fromStorage = safeStorageGet('local', VISITOR_KEY);
    var id = fromCookie || fromStorage;
    if (!id) {
      id = 'vid_' + randomToken() + Date.now().toString(36);
    }
    writeCookie(VISITOR_COOKIE, id);
    safeStorageSet('local', VISITOR_KEY, id);
    return id;
  }

  function randomToken() {
    try {
      if (window.crypto && crypto.getRandomValues) {
        var bytes = new Uint8Array(9);
        crypto.getRandomValues(bytes);
        var out = '';
        for (var i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
        return out;
      }
    } catch (err) { /* ignore */ }
    return Math.random().toString(36).slice(2, 12);
  }

  function parseForce() {
    var match = location.search.match(/[?&]splittag_force=([^&]+)/);
    if (!match) return null;
    var raw = decodeURIComponent(match[1]);
    var split = raw.indexOf(':');
    if (split < 1) return null;
    var expId = raw.slice(0, split);
    var variantId = raw.slice(split + 1);
    if (!expId || !variantId) return null;
    return { expId: expId, variantId: variantId };
  }

  /* ------------------------------------------------------------------ */
  /* Assignment                                                          */
  /* ------------------------------------------------------------------ */

  function readAssignments() {
    try {
      var raw = window.localStorage.getItem(ASSIGN_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function persistAssignments() {
    if (preview) return; // QA traffic must not change the visitor's real bucket
    try {
      window.localStorage.setItem(ASSIGN_KEY, JSON.stringify(assignments));
    } catch (err) { /* storage disabled */ }
  }

  function decideAssignments() {
    var stored = readAssignments();
    var changed = false;

    cfg.experiments.forEach(function (exp) {
      if (!exp || !exp.id || !Array.isArray(exp.variants) || exp.variants.length === 0) return;
      if (!matchesTarget(exp.targetUrlPattern, location.pathname)) return;

      var variantId = null;

      if (force && force.expId === exp.id) {
        preview = true;
        variantId = resolveForcedVariant(exp, force.variantId);
      } else if (stored[exp.id] && hasVariant(exp, stored[exp.id])) {
        // Sticky: a stored assignment wins forever, even if weights change.
        variantId = stored[exp.id];
      } else {
        var decision = B.assignVariant(
          visitorId,
          exp.id,
          exp.variants,
          typeof exp.trafficAllocation === 'number' ? exp.trafficAllocation : 1
        );
        if (decision.admitted && decision.variantId) {
          variantId = decision.variantId;
          assignments[exp.id] = variantId;
          changed = true;
        }
      }

      if (variantId) {
        assignments[exp.id] = variantId;
        experiments[exp.id] = exp;
        (exp.goals || []).forEach(function (goal) {
          allGoals.push({ experimentId: exp.id, variantId: variantId, goal: goal });
        });
      }
    });

    if (changed) persistAssignments();
  }

  function resolveForcedVariant(exp, requested) {
    var wanted = requested === 'control' ? exp.variants[0].id : requested;
    return hasVariant(exp, wanted) ? wanted : null;
  }

  function hasVariant(exp, variantId) {
    return exp.variants.some(function (variant) { return variant.id === variantId; });
  }

  function matchesTarget(pattern, pathname) {
    if (typeof pattern !== 'string' || pattern === '') return true;
    if (pattern === '/') return pathname === '/';
    if (pattern.indexOf('*') === -1) return pathname.indexOf(pattern) !== -1;
    var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try {
      return new RegExp('^' + escaped + '$').test(pathname);
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Change application                                                  */
  /* ------------------------------------------------------------------ */

  function registerReadyHandler() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyAndReveal, { once: true });
    } else {
      applyAndReveal();
    }
  }

  function applyAndReveal() {
    try {
      applyAllChanges();
      changesAppliedAt = now();
      debug.changesAppliedAt = changesAppliedAt;
      if (pendingChanges.length > 0) installMutationObserver();
      window.requestAnimationFrame(function () { reveal('changes-applied'); });
    } catch (err) {
      if (window.console && console.warn) console.warn('[SplitTag] apply failed:', err);
      reveal('apply-error');
    }
  }

  function applyAllChanges() {
    var styleParts = [];
    pendingChanges = [];

    Object.keys(assignments).forEach(function (expId) {
      var exp = experiments[expId];
      var variant = exp.variants.filter(function (v) { return v.id === assignments[expId]; })[0];
      if (!variant) return;
      (variant.changes || []).forEach(function (change) { applyChange(change, styleParts); });
    });

    appendVariantStyles(styleParts);
  }

  function appendVariantStyles(styleParts) {
    if (!styleParts || styleParts.length === 0) return;
    // A scoped stylesheet gives predictable specificity and also covers nodes
    // rendered after the initial reveal.
    var tag = document.getElementById('splittag-variant-styles');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'splittag-variant-styles';
      (document.head || document.documentElement).appendChild(tag);
    }
    tag.textContent += (tag.textContent ? '\n' : '') + styleParts.join('\n');
  }

  function applyChange(change, styleParts) {
    if (!change || typeof change !== 'object' || !change.selector) return;

    if (change.type === 'style') {
      var decl = Object.keys(change.props || {}).map(function (prop) {
        return toKebab(prop) + ':' + change.props[prop] + ' !important';
      }).join(';');
      if (decl) styleParts.push(change.selector + '{' + decl + ';}');
      return;
    }

    if (change.type === 'hide') {
      styleParts.push(change.selector + '{display:none !important;}');
      return;
    }

    var nodes;
    try {
      nodes = document.querySelectorAll(change.selector);
    } catch (err) {
      return;
    }

    if (change.type === 'move') {
      var target = nodes[0];
      var reference = null;
      try {
        reference = change.beforeSelector
          ? document.querySelector(change.beforeSelector)
          : document.querySelector(change.afterSelector);
      } catch (err) { /* invalid reference */ }
      if (!target || !reference) {
        pendingChanges.push(change);
        return;
      }
      if (change.beforeSelector) reference.parentNode.insertBefore(target, reference);
      else reference.parentNode.insertBefore(target, reference.nextSibling);
      return;
    }

    if (nodes.length === 0) {
      pendingChanges.push(change);
      return;
    }

    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (change.type === 'text') el.textContent = change.value;
      else if (change.type === 'html') el.innerHTML = change.value;
      else if (change.type === 'attr') el.setAttribute(change.name, change.value);
      else if (change.type === 'class') {
        (change.remove || []).forEach(function (name) { el.classList.remove(name); });
        (change.add || []).forEach(function (name) { el.classList.add(name); });
      }
    }
  }

  function installMutationObserver() {
    if (typeof MutationObserver === 'undefined' || !document.documentElement) return;
    mutationDeadline = now() + MUTATION_WINDOW_MS;
    observer = new MutationObserver(processPendingChanges);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Bounded window: never observe forever, even if no mutation occurs.
    setTimeout(stopObserver, MUTATION_WINDOW_MS);
  }

  function processPendingChanges() {
    if (pendingChanges.length === 0) {
      stopObserver();
      return;
    }
    // Work from a snapshot. applyChange pushes still-unresolved changes back
    // onto pendingChanges, so the list is rebuilt as a side effect.
    var unresolved = pendingChanges.slice();
    pendingChanges = [];
    var newStyleParts = [];
    unresolved.forEach(function (change) { applyChange(change, newStyleParts); });
    appendVariantStyles(newStyleParts);
    if (pendingChanges.length === 0 || now() > mutationDeadline) stopObserver();
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function toKebab(prop) {
    return String(prop).replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
  }

  /* ------------------------------------------------------------------ */
  /* Anti-flicker                                                        */
  /* ------------------------------------------------------------------ */

  function installAntiFlickerGuard() {
    var rootSelector = (window.SPLITTAG_CONFIG && window.SPLITTAG_CONFIG.hideSelector) || 'html';
    var style = document.createElement('style');
    style.id = 'splittag-antiflicker';
    style.textContent = rootSelector + '{visibility:hidden !important;}';
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function reveal(reason) {
    if (revealed) return;
    revealed = true;
    revealedAt = now();
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    if (guardStyle && guardStyle.parentNode) guardStyle.parentNode.removeChild(guardStyle);
    debug.revealedAt = revealedAt;
    debug.revealDelay = revealedAt - startedAt;
    debug.revealReason = reason;

    // Exposure is sent once per visitor, experiment, and browser session.
    fireExposures();
    // Run one scroll check after layout so above-the-fold thresholds can fire.
    setTimeout(checkScrollDepth, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Tracking                                                            */
  /* ------------------------------------------------------------------ */

  function installTracking() {
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('submit', onDocumentSubmit, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushEvents();
    });
    window.addEventListener('pagehide', flushEvents);

    // Programmatic form.submit() does not fire a submit event.
    if (window.HTMLFormElement && HTMLFormElement.prototype.submit) {
      var originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function () {
        trackFormGoals(this, { programmatic: true });
        return originalSubmit.apply(this, arguments);
      };
    }
  }

  function onDocumentClick(event) {
    var goal;
    var target;
    for (var i = 0; i < allGoals.length; i += 1) {
      goal = allGoals[i];
      if (!goal.goal || goal.goal.type !== 'click' || !goal.goal.selector) continue;
      try {
        target = event.target && event.target.closest ? event.target.closest(goal.goal.selector) : null;
      } catch (err) {
        target = null;
      }
      if (target) fireGoal(goal, { element: describeElement(target) });
    }

    // Buttons that submit a form via JavaScript still count as form submits.
    var button = event.target && event.target.closest
      ? event.target.closest('button[type="submit"], input[type="submit"], button:not([type])')
      : null;
    if (button && button.form) trackFormGoals(button.form, { via: 'button-click' });
  }

  function onDocumentSubmit(event) {
    trackFormGoals(event.target, { via: 'submit-event' });
  }

  function trackFormGoals(form, meta) {
    if (!form) return;
    allGoals.forEach(function (goal) {
      if (!goal.goal || goal.goal.type !== 'form_submit' || !goal.goal.selector) return;
      var match = false;
      try {
        match = form.matches(goal.goal.selector) || Boolean(form.closest(goal.goal.selector));
      } catch (err) {
        match = false;
      }
      if (match) fireGoal(goal, meta || {});
    });
  }

  function onScroll() {
    if (onScroll.ticking) return;
    onScroll.ticking = true;
    window.requestAnimationFrame(function () {
      onScroll.ticking = false;
      checkScrollDepth();
    });
  }

  function checkScrollDepth() {
    var doc = document.documentElement;
    var body = document.body || {};
    var scrollHeight = Math.max(doc.scrollHeight || 0, body.scrollHeight || 0, doc.clientHeight || 0);
    var viewport = window.innerHeight || doc.clientHeight || 0;
    var maxScroll = Math.max(0, scrollHeight - viewport);
    var position = Math.max(window.pageYOffset || 0, doc.scrollTop || 0);
    var percent = maxScroll <= 0 ? 100 : Math.min(100, Math.round((position / maxScroll) * 100));
    if (percent < (checkScrollDepth.max || 0)) percent = checkScrollDepth.max;
    checkScrollDepth.max = percent;

    allGoals.forEach(function (goal) {
      if (!goal.goal || goal.goal.type !== 'scroll_depth') return;
      if (percent >= goal.goal.threshold) {
        fireGoal(goal, { scrollDepth: goal.goal.threshold, maxScrollPercent: percent });
      }
    });
  }

  function fireGoal(goal, meta) {
    if (preview) return;
    if (!goal || !goal.goal || !goal.goal.id) return;
    var key = 'splittag_goal_' + goal.experimentId + '_' + goal.goal.id;
    if (goalMemory[key] || safeStorageGet('local', key)) return; // once per visitor
    goalMemory[key] = true;
    safeStorageSet('local', key, '1');
    enqueueEvent({
      type: 'goal',
      goalId: goal.goal.id,
      experimentId: goal.experimentId,
      variantId: goal.variantId,
      visitorId: visitorId,
      url: location.href,
      timestamp: Date.now(),
      meta: meta || {}
    });
  }

  function fireExposures() {
    if (preview || editorMode) return;
    Object.keys(assignments).forEach(function (expId) {
      var sessionKey = 'splittag_exposed_' + expId;
      try {
        if (window.sessionStorage.getItem(sessionKey)) return;
        window.sessionStorage.setItem(sessionKey, '1');
      } catch (err) {
        if (goalMemory[sessionKey]) return;
        goalMemory[sessionKey] = true;
      }
      enqueueEvent({
        type: 'exposure',
        experimentId: expId,
        variantId: assignments[expId],
        visitorId: visitorId,
        url: location.href,
        timestamp: Date.now()
      });
    });
  }

  function enqueueEvent(event) {
    if (preview || editorMode) return;
    queue.push(event);
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flushEvents();
    }, BATCH_DELAY_MS);
  }

  function flushEvents() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (queue.length === 0) return;
    var batch = queue;
    queue = [];
    var body;
    try {
      body = JSON.stringify(batch);
    } catch (err) {
      return;
    }

    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/events', blob)) return;
      }
    } catch (err) { /* fall through */ }

    try {
      fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () { /* best effort */ });
    } catch (err) { /* no fetch */ }
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  function exposeApi() {
    window.SplitTag = {
      /** @param {string} expId @returns {string|null} */
      getAssignment: function (expId) {
        return Object.prototype.hasOwnProperty.call(assignments, expId) ? assignments[expId] : null;
      },
      /** @returns {Record<string, string>} */
      getAssignments: function () {
        var copy = {};
        Object.keys(assignments).forEach(function (key) { copy[key] = assignments[key]; });
        return copy;
      },
      /**
       * Record a conversion for a goal belonging to any assigned experiment.
       * @param {string} goalId
       * @param {object} [meta]
       * @returns {boolean} whether at least one goal matched
       */
      track: function (goalId, meta) {
        var matched = false;
        allGoals.forEach(function (goal) {
          if (goal.goal && goal.goal.id === goalId) {
            matched = true;
            fireGoal(goal, meta || {});
          }
        });
        return matched;
      },
      preview: preview,
      version: VERSION,
      _debug: debug
    };
  }

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                     */
  /* ------------------------------------------------------------------ */

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function safeStorageGet(kind, key) {
    try {
      return window[kind + 'Storage'].getItem(key);
    } catch (err) {
      return null;
    }
  }

  function safeStorageSet(kind, key, value) {
    try {
      window[kind + 'Storage'].setItem(key, value);
    } catch (err) { /* storage disabled */ }
  }

  function describeElement(el) {
    if (!el || !el.tagName) return null;
    return el.id ? '#' + el.id : el.tagName.toLowerCase();
  }

  /**
   * Embedded fallback copy of shared/bucketing.js. The demo page loads the
   * shared file first, but a marketer's two-line install must work with the
   * snippet alone. tests/unit/bucketing.test.js asserts byte-level parity of
   * the hash with the shared module.
   */
  function embeddedBucketing() {
    function fnv1a32(input) {
      var hash = 0x811c9dc5;
      for (var i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return hash >>> 0;
    }
    function unitFor(visitor, exp) {
      return fnv1a32(visitor + ':' + exp) / 4294967296;
    }
    function variantUnitFor(visitor, exp) {
      var hash = fnv1a32(visitor + ':' + exp);
      return (Math.imul(hash, 0x9e3779b1) >>> 0) / 4294967296;
    }
    function pickVariant(variants, unit) {
      var total = 0;
      variants.forEach(function (variant) { total += Math.max(0, Number(variant.weight) || 0); });
      if (total <= 0) return variants[0] ? variants[0].id : null;
      var target = unit * total;
      var cumulative = 0;
      for (var i = 0; i < variants.length; i += 1) {
        cumulative += Math.max(0, Number(variants[i].weight) || 0);
        if (target < cumulative) return variants[i].id;
      }
      return variants[variants.length - 1].id;
    }
    function assignVariant(visitor, exp, variants, allocation) {
      var allocationUnit = unitFor(visitor, exp);
      var variantUnit = variantUnitFor(visitor, exp);
      if (allocationUnit >= allocation) {
        return { admitted: false, variantId: null, allocationUnit: allocationUnit, variantUnit: variantUnit };
      }
      return {
        admitted: true,
        variantId: pickVariant(variants, variantUnit),
        allocationUnit: allocationUnit,
        variantUnit: variantUnit
      };
    }
    return {
      fnv1a32: fnv1a32,
      unitFor: unitFor,
      variantUnitFor: variantUnitFor,
      pickVariant: pickVariant,
      assignVariant: assignVariant
    };
  }
})();
