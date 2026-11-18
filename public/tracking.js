/*!
 * SplitTag standalone tracker (classic script).
 *
 * The pre-paint snippet bundles an equivalent tracker so the two-line install
 * stays self-contained. This file is the same behavior as a standalone module
 * for pages that want to load tracking separately, and it is the readable
 * reference implementation for click, form-submit, and scroll-depth goals.
 */
(function (root) {
  'use strict';

  var BATCH_DELAY = 350;

  /**
   * Create a tracker.
   * @param {{
   *   visitorId: string,
   *   assignments: Record<string,string>,
   *   goals: Array<{experimentId:string, variantId:string, goal:object}>,
   *   preview?: boolean,
   *   endpoint?: string,
   *   batchDelay?: number
   * }} options
   */
  function create(options) {
    var visitorId = options.visitorId;
    var assignments = options.assignments || {};
    var goals = options.goals || [];
    var preview = Boolean(options.preview);
    var endpoint = options.endpoint || '/api/events';
    var delay = options.batchDelay === undefined ? BATCH_DELAY : options.batchDelay;
    var queue = [];
    var timer = null;
    var fired = {};
    var maxScroll = 0;
    var ticking = false;

    function storageKey(goal) {
      return 'splittag_goal_' + goal.experimentId + '_' + goal.goal.id;
    }

    function alreadyFired(goal) {
      var key = storageKey(goal);
      if (fired[key]) return true;
      try {
        if (root.localStorage.getItem(key)) {
          fired[key] = true;
          return true;
        }
      } catch (err) { /* storage disabled */ }
      return false;
    }

    function markFired(goal) {
      var key = storageKey(goal);
      fired[key] = true;
      try { root.localStorage.setItem(key, '1'); } catch (err) { /* ignore */ }
    }

    function trackGoal(goal, meta) {
      if (preview || !goal || !goal.goal || !goal.goal.id) return false;
      if (alreadyFired(goal)) return false;
      markFired(goal);
      enqueue({
        type: 'goal',
        goalId: goal.goal.id,
        experimentId: goal.experimentId,
        variantId: goal.variantId,
        visitorId: visitorId,
        url: root.location.href,
        timestamp: Date.now(),
        meta: meta || {}
      });
      return true;
    }

    function enqueue(event) {
      if (preview) return;
      queue.push(event);
      if (timer) return;
      timer = root.setTimeout(function () {
        timer = null;
        flush();
      }, delay);
    }

    function flush() {
      if (timer) {
        root.clearTimeout(timer);
        timer = null;
      }
      if (queue.length === 0) return;
      var batch = queue;
      queue = [];
      var body;
      try { body = JSON.stringify(batch); } catch (err) { return; }
      try {
        if (root.navigator.sendBeacon) {
          var blob = new Blob([body], { type: 'application/json' });
          if (root.navigator.sendBeacon(endpoint, blob)) return;
        }
      } catch (err) { /* fall through */ }
      try {
        root.fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body,
          keepalive: true
        }).catch(function () {});
      } catch (err) { /* no fetch */ }
    }

    function onclick(event) {
      goals.forEach(function (goal) {
        if (goal.goal.type !== 'click' || !goal.goal.selector) return;
        var target;
        try {
          target = event.target && event.target.closest ? event.target.closest(goal.goal.selector) : null;
        } catch (err) { target = null; }
        if (target) trackGoal(goal, { element: target.id ? '#' + target.id : target.tagName.toLowerCase() });
      });

      var button = event.target && event.target.closest
        ? event.target.closest('button[type="submit"], input[type="submit"], button:not([type])')
        : null;
      if (button && button.form) trackForm(button.form, { via: 'button-click' });
    }

    function onsubmit(event) {
      trackForm(event.target, { via: 'submit-event' });
    }

    function trackForm(form, meta) {
      if (!form) return;
      goals.forEach(function (goal) {
        if (goal.goal.type !== 'form_submit' || !goal.goal.selector) return;
        var match = false;
        try {
          match = form.matches(goal.goal.selector) || Boolean(form.closest(goal.goal.selector));
        } catch (err) { match = false; }
        if (match) trackGoal(goal, meta || {});
      });
    }

    function checkScroll() {
      var doc = root.document.documentElement;
      var body = root.document.body || {};
      var scrollHeight = Math.max(doc.scrollHeight || 0, body.scrollHeight || 0, doc.clientHeight || 0);
      var viewport = root.innerHeight || doc.clientHeight || 0;
      var max = Math.max(0, scrollHeight - viewport);
      var top = Math.max(root.pageYOffset || 0, doc.scrollTop || 0);
      var percent = max <= 0 ? 100 : Math.min(100, Math.round((top / max) * 100));
      maxScroll = Math.max(maxScroll, percent);
      goals.forEach(function (goal) {
        if (goal.goal.type !== 'scroll_depth') return;
        if (maxScroll >= goal.goal.threshold) {
          trackGoal(goal, { scrollDepth: goal.goal.threshold, maxScrollPercent: maxScroll });
        }
      });
    }

    function onscroll() {
      if (ticking) return;
      ticking = true;
      root.requestAnimationFrame(function () {
        ticking = false;
        checkScroll();
      });
    }

    function onvisibility() {
      if (root.document.visibilityState === 'hidden') flush();
    }

    root.document.addEventListener('click', onclick, true);
    root.document.addEventListener('submit', onsubmit, true);
    root.addEventListener('scroll', onscroll, { passive: true });
    root.addEventListener('resize', onscroll, { passive: true });
    root.document.addEventListener('visibilitychange', onvisibility);
    root.addEventListener('pagehide', flush);

    root.setTimeout(checkScroll, 0);

    return {
      trackGoal: trackGoal,
      trackGoalId: function (goalId, meta) {
        var matched = goals.filter(function (goal) { return goal.goal.id === goalId; });
        matched.forEach(function (goal) { trackGoal(goal, meta); });
        return matched.length > 0;
      },
      enqueue: enqueue,
      flush: flush,
      checkScroll: checkScroll,
      getQueueLength: function () { return queue.length; },
      destroy: function () {
        root.document.removeEventListener('click', onclick, true);
        root.document.removeEventListener('submit', onsubmit, true);
        root.removeEventListener('scroll', onscroll);
        root.removeEventListener('resize', onscroll);
        root.document.removeEventListener('visibilitychange', onvisibility);
        root.removeEventListener('pagehide', flush);
      }
    };
  }

  root.SplitTagTracking = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
