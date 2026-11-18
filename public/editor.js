/**
 * SplitTag visual variant editor.
 *
 * The editor is a plain ES module. It loads experiments from the Express API,
 * renders a WYSIWYG iframe of the demo page, and records element-level changes
 * into the selected variant. There is no server-side template editor: the
 * production snippet consumes exactly the JSON saved here.
 */

import { generateSelector, applyChangeToDocument } from '/selector.js';

const frame = document.getElementById('preview-frame');
const settingsPanel = document.getElementById('settings-panel');
const experimentList = document.getElementById('experiment-list');
const saveIndicator = document.getElementById('save-indicator');
const inspector = document.getElementById('inspector');
const selectorInput = document.getElementById('selector-input');
const selectionHint = document.getElementById('selection-hint');
const selectedSelectorEl = document.getElementById('selected-selector');
const jsonDrawer = document.getElementById('json-drawer');
const jsonView = document.getElementById('json-view');

let experiments = [];
let current = null;
let savedSnapshot = null;
let isNew = false;
let activeVariantId = null;
let selected = null;
let pickMode = null; // 'change' | { type: 'goal', goalId } | { type: 'move', position }
let frameBound = false;

const $ = (id) => document.getElementById(id);

boot();

async function boot() {
  bindStaticControls();
  try {
    const response = await fetch('/api/experiments');
    if (!response.ok) throw new Error(`GET /api/experiments returned ${response.status}`);
    experiments = await response.json();
  } catch (err) {
    experiments = [];
    setIndicator('error', `Could not load experiments: ${err.message}`);
  }

  if (experiments.length > 0) {
    loadExperiment(experiments[0].id);
  } else {
    startNewExperiment();
  }
}

function bindStaticControls() {
  $('new-experiment').addEventListener('click', startNewExperiment);
  $('save-btn').addEventListener('click', () => { save(); });
  $('preview-btn').addEventListener('click', previewVariant);
  $('json-toggle').addEventListener('click', toggleJson);
  $('json-close').addEventListener('click', toggleJson);
  $('selector-go').addEventListener('click', selectBySelector);
  selectorInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectBySelector();
    }
  });
  $('clear-selection').addEventListener('click', clearSelection);
  $('apply-text').addEventListener('click', applyText);
  $('apply-html').addEventListener('click', applyHtml);
  $('apply-style').addEventListener('click', applyStyle);
  $('apply-class').addEventListener('click', applyClass);
  $('hide-element').addEventListener('click', applyHide);
  $('apply-attr').addEventListener('click', applyAttr);
  $('move-before').addEventListener('click', () => armMove('before'));
  $('move-after').addEventListener('click', () => armMove('after'));

  frame.addEventListener('load', bindFrame);
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

/* ------------------------------------------------------------------ */
/* Experiment loading and saving                                       */
/* ------------------------------------------------------------------ */

function loadExperiment(id) {
  if (isDirty() && current && !window.confirm('Discard unsaved changes?')) return;
  const found = experiments.find((exp) => exp.id === id);
  if (!found) return;
  current = clone(found);
  savedSnapshot = JSON.stringify(current);
  isNew = false;
  activeVariantId = current.variants[0] ? current.variants[0].id : null;
  selected = null;
  pickMode = null;
  renderExperimentList();
  renderSettings();
  updateIndicator();
  syncJson();
  reloadPreview();
}

function startNewExperiment() {
  if (isDirty() && current && !window.confirm('Discard unsaved changes and create a new experiment?')) return;
  const suffix = Date.now().toString(36);
  current = {
    id: `exp-${suffix}`,
    name: 'Untitled experiment',
    status: 'draft',
    targetUrlPattern: '/',
    trafficAllocation: 1,
    variants: [
      { id: 'control', name: 'Control', weight: 0.5, changes: [] },
      { id: `variant-${suffix}`, name: 'Variant 1', weight: 0.5, changes: [] }
    ],
    goals: []
  };
  savedSnapshot = null;
  isNew = true;
  activeVariantId = current.variants[0].id;
  selected = null;
  pickMode = null;
  experiments.push(current);
  renderExperimentList();
  renderSettings();
  updateIndicator();
  syncJson();
  reloadPreview();
}

async function save() {
  if (!current) return false;
  const error = clientValidate(current);
  if (error) {
    setIndicator('error', error);
    return false;
  }
  try {
    setIndicator('dirty', 'Saving…');
    const response = await fetch('/api/experiments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(current)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Save failed (${response.status})`);
    current = clone(payload);
    const index = experiments.findIndex((exp) => exp.id === current.id);
    if (index >= 0) experiments[index] = clone(current);
    else experiments.push(clone(current));
    savedSnapshot = JSON.stringify(current);
    isNew = false;
    renderExperimentList();
    renderSettings();
    updateIndicator('saved', 'All changes saved');
    syncJson();
    return true;
  } catch (err) {
    setIndicator('error', `Save failed: ${err.message}`);
    return false;
  }
}

async function previewVariant() {
  if (!current) return;
  const saved = await save();
  if (!saved) return;
  const variantId = activeVariantId || (current.variants[0] && current.variants[0].id);
  const url = `/?splittag_force=${encodeURIComponent(current.id)}:${encodeURIComponent(variantId)}`;
  window.open(url, '_blank', 'noopener');
}

function clientValidate(exp) {
  if (!exp.name || !exp.name.trim()) return 'Experiment name is required.';
  if (!exp.id) return 'Experiment id is required.';
  if (exp.variants.length === 0) return 'Add at least one variant.';
  for (const variant of exp.variants) {
    if (!variant.name || !variant.name.trim()) return 'Every variant needs a name.';
    if (!(Number(variant.weight) >= 0)) return `Weight for ${variant.name} must be 0 or more.`;
  }
  const total = exp.variants.reduce((sum, variant) => sum + Number(variant.weight || 0), 0);
  if (total <= 0) return 'Variant weights must sum to more than 0.';
  if (total > 1.0001) return `Variant weights sum to ${total.toFixed(2)}; keep the total at or below 1.`;
  for (const goal of exp.goals) {
    if (!goal.name || !goal.name.trim()) return 'Every goal needs a name.';
    if ((goal.type === 'click' || goal.type === 'form_submit') && !goal.selector) {
      return `Goal "${goal.name}" needs a selector. Use Pick to choose an element.`;
    }
    if (goal.type === 'scroll_depth' && !(Number(goal.threshold) >= 1 && Number(goal.threshold) <= 100)) {
      return `Goal "${goal.name}" needs a scroll threshold between 1 and 100.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Right-side settings panel                                           */
/* ------------------------------------------------------------------ */

function renderSettings() {
  if (!current) {
    settingsPanel.innerHTML = '<p class="muted">No experiment selected.</p>';
    return;
  }
  const active = currentVariant();
  const weightSum = current.variants.reduce((sum, variant) => sum + Number(variant.weight || 0), 0);

  settingsPanel.innerHTML = `
    <div class="field">
      <label for="exp-name">Experiment name</label>
      <input id="exp-name" type="text" value="${esc(current.name)}" autocomplete="off">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="exp-id">ID (immutable)</label>
        <input id="exp-id" type="text" value="${esc(current.id)}" disabled>
      </div>
      <div class="field">
        <label for="exp-status">Status</label>
        <select id="exp-status">
          ${['draft', 'running', 'stopped'].map((status) =>
            `<option value="${status}" ${current.status === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="target-url">Target URL pattern</label>
      <input id="target-url" type="text" value="${esc(current.targetUrlPattern)}" placeholder="/" autocomplete="off">
    </div>
    <div class="field">
      <label for="traffic">Traffic allocation <span class="traffic-value" id="traffic-value">${Math.round(current.trafficAllocation * 100)}%</span></label>
      <div class="traffic-row">
        <input id="traffic" type="range" min="0" max="100" step="1" value="${Math.round(current.trafficAllocation * 100)}">
      </div>
    </div>

    <div class="section-label">
      <span>Variants · ${weightSum.toFixed(2)} weight</span>
      <button type="button" class="btn btn-small" id="add-variant">Add variant</button>
    </div>
    <ul class="variant-list">
      ${current.variants.map((variant, index) => variantMarkup(variant, index, active)).join('')}
    </ul>

    <div class="section-label">
      <span>Goals</span>
      <button type="button" class="btn btn-small" id="add-goal">Add goal</button>
    </div>
    <ul class="goal-list">
      ${current.goals.length === 0
        ? '<li class="muted small">No goals yet. Add a click, form submit, or scroll-depth goal.</li>'
        : current.goals.map((goal) => goalMarkup(goal)).join('')}
    </ul>
  `;

  $('exp-name').addEventListener('input', (event) => {
    current.name = event.target.value;
    renderExperimentList();
    markDirty();
  });
  $('exp-status').addEventListener('change', (event) => {
    current.status = event.target.value;
    renderExperimentList();
    markDirty();
  });
  $('target-url').addEventListener('input', (event) => {
    current.targetUrlPattern = event.target.value;
    markDirty();
  });
  $('traffic').addEventListener('input', (event) => {
    current.trafficAllocation = Number(event.target.value) / 100;
    $('traffic-value').textContent = `${event.target.value}%`;
    markDirty();
  });
  $('add-variant').addEventListener('click', addVariant);
  $('add-goal').addEventListener('click', addGoal);

  settingsPanel.querySelectorAll('[data-variant-select]').forEach((button) => {
    button.addEventListener('click', () => selectVariant(button.dataset.variantSelect));
  });
  settingsPanel.querySelectorAll('[data-variant-name]').forEach((input) => {
    input.addEventListener('input', () => {
      const variant = current.variants.find((item) => item.id === input.dataset.variantName);
      if (variant) {
        variant.name = input.value;
        renderExperimentList();
        markDirty();
      }
    });
  });
  settingsPanel.querySelectorAll('[data-variant-weight]').forEach((input) => {
    input.addEventListener('input', () => {
      const variant = current.variants.find((item) => item.id === input.dataset.variantWeight);
      if (variant) {
        variant.weight = Number(input.value);
        markDirty();
      }
    });
  });
  settingsPanel.querySelectorAll('[data-remove-variant]').forEach((button) => {
    button.addEventListener('click', () => removeVariant(button.dataset.removeVariant));
  });
  settingsPanel.querySelectorAll('[data-remove-change]').forEach((button) => {
    button.addEventListener('click', () => {
      const [variantId, index] = button.dataset.removeChange.split(':');
      removeChange(variantId, Number(index));
    });
  });
  settingsPanel.querySelectorAll('[data-goal-name]').forEach((input) => {
    input.addEventListener('input', () => {
      const goal = current.goals.find((item) => item.id === input.dataset.goalName);
      if (goal) { goal.name = input.value; markDirty(); }
    });
  });
  settingsPanel.querySelectorAll('[data-goal-type]').forEach((select) => {
    select.addEventListener('change', () => {
      const goal = current.goals.find((item) => item.id === select.dataset.goalType);
      if (!goal) return;
      goal.type = select.value;
      if (goal.type === 'scroll_depth' && !goal.threshold) goal.threshold = 75;
      if (goal.type === 'scroll_depth') delete goal.selector;
      else if (!goal.selector) goal.selector = '';
      renderSettings();
      markDirty();
    });
  });
  settingsPanel.querySelectorAll('[data-goal-selector]').forEach((input) => {
    input.addEventListener('input', () => {
      const goal = current.goals.find((item) => item.id === input.dataset.goalSelector);
      if (goal) { goal.selector = input.value; markDirty(); }
    });
  });
  settingsPanel.querySelectorAll('[data-goal-threshold]').forEach((input) => {
    input.addEventListener('input', () => {
      const goal = current.goals.find((item) => item.id === input.dataset.goalThreshold);
      if (goal) { goal.threshold = Number(input.value); markDirty(); }
    });
  });
  settingsPanel.querySelectorAll('[data-goal-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      current.goals = current.goals.filter((goal) => goal.id !== button.dataset.goalRemove);
      renderSettings();
      markDirty();
    });
  });
  settingsPanel.querySelectorAll('[data-goal-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      pickMode = { type: 'goal', goalId: button.dataset.goalPick };
      updateHint(`Click the element to use as the selector for this goal.`, true);
    });
  });
}

function variantMarkup(variant, index, active) {
  const isActive = active && active.id === variant.id;
  return `
    <li class="variant-card" data-active="${isActive}">
      <div class="variant-card-head">
        <button type="button" class="variant-select" data-variant-select="${esc(variant.id)}" aria-pressed="${isActive}">
          ${esc(variant.name || 'Unnamed variant')}
        </button>
        ${index === 0 ? '<span class="control-badge">Control</span>' : ''}
        <span class="count-badge">${variant.changes.length} change${variant.changes.length === 1 ? '' : 's'}</span>
        ${index === 0 ? '' : `<button type="button" class="icon-btn" data-remove-variant="${esc(variant.id)}" aria-label="Remove variant ${esc(variant.name)}">×</button>`}
      </div>
      <div class="field-row">
        <div class="field">
          <label for="variant-name-${esc(variant.id)}">Variant name</label>
          <input id="variant-name-${esc(variant.id)}" type="text" value="${esc(variant.name)}" data-variant-name="${esc(variant.id)}" autocomplete="off">
        </div>
        <div class="field">
          <label for="variant-weight-${esc(variant.id)}">Weight</label>
          <input id="variant-weight-${esc(variant.id)}" type="number" min="0" max="1" step="0.05" value="${Number(variant.weight)}" data-variant-weight="${esc(variant.id)}">
        </div>
      </div>
      ${variant.changes.length ? `<ul class="change-list">
        ${variant.changes.map((change, changeIndex) => `
          <li class="change-item">
            <span><strong>${esc(change.type)}</strong> <code>${esc(change.selector)}</code>${changeDescription(change)}</span>
            <button type="button" data-remove-change="${esc(variant.id)}:${changeIndex}" aria-label="Remove ${esc(change.type)} change on ${esc(change.selector)}">×</button>
          </li>`).join('')}
      </ul>` : ''}
    </li>
  `;
}

function changeDescription(change) {
  if (change.type === 'text' || change.type === 'html') return ` → ${esc(String(change.value).slice(0, 42))}`;
  if (change.type === 'move') return ` ${change.beforeSelector ? 'before' : 'after'} ${esc(change.beforeSelector || change.afterSelector)}`;
  if (change.type === 'style') return ` ${esc(Object.keys(change.props || {}).join(', '))}`;
  return '';
}

function goalMarkup(goal) {
  const typeOptions = ['click', 'form_submit', 'scroll_depth']
    .map((type) => `<option value="${type}" ${goal.type === type ? 'selected' : ''}>${type.replace('_', ' ')}</option>`)
    .join('');
  return `
    <li class="goal-card">
      <div class="goal-head">
        <input type="text" value="${esc(goal.name)}" data-goal-name="${esc(goal.id)}" aria-label="Goal name" autocomplete="off">
        <button type="button" class="icon-btn" data-goal-remove="${esc(goal.id)}" aria-label="Remove goal ${esc(goal.name)}">×</button>
      </div>
      <div class="goal-row">
        <label class="sr-only" for="goal-type-${esc(goal.id)}">Goal type</label>
        <select id="goal-type-${esc(goal.id)}" data-goal-type="${esc(goal.id)}">${typeOptions}</select>
        ${goal.type === 'scroll_depth'
          ? `<label class="sr-only" for="goal-threshold-${esc(goal.id)}">Scroll threshold percent</label>
             <input id="goal-threshold-${esc(goal.id)}" type="number" min="1" max="100" value="${Number(goal.threshold || 75)}" data-goal-threshold="${esc(goal.id)}" aria-label="Scroll threshold percent">`
          : `<label class="sr-only" for="goal-selector-${esc(goal.id)}">Goal CSS selector</label>
             <input id="goal-selector-${esc(goal.id)}" type="text" value="${esc(goal.selector || '')}" data-goal-selector="${esc(goal.id)}" placeholder="#cta-primary" autocomplete="off">`}
      </div>
      ${goal.type !== 'scroll_depth'
        ? `<div class="goal-row wide">
             <span class="muted small">id: ${esc(goal.id)}</span>
             <button type="button" class="btn btn-small goal-pick" data-goal-pick="${esc(goal.id)}">Pick element</button>
           </div>`
        : `<span class="muted small">id: ${esc(goal.id)} · fires once when max scroll passes the threshold</span>`}
    </li>
  `;
}

function addVariant() {
  if (!current) return;
  const count = current.variants.length + 1;
  const weight = Number((1 / count).toFixed(4));
  current.variants.forEach((variant) => { variant.weight = weight; });
  const id = uniqueId('variant', current.variants.map((variant) => variant.id));
  current.variants.push({ id, name: `Variant ${count - 1}`, weight, changes: [] });
  activeVariantId = id;
  renderSettings();
  markDirty();
  reloadPreview();
}

function removeVariant(id) {
  if (!current || current.variants.length <= 1) return;
  const index = current.variants.findIndex((variant) => variant.id === id);
  if (index <= 0) return; // never remove the control
  current.variants.splice(index, 1);
  const weight = Number((1 / current.variants.length).toFixed(4));
  current.variants.forEach((variant) => { variant.weight = weight; });
  if (activeVariantId === id) activeVariantId = current.variants[0].id;
  renderSettings();
  markDirty();
  reloadPreview();
}

function addGoal() {
  if (!current) return;
  const id = uniqueId('goal', current.goals.map((goal) => goal.id));
  current.goals.push({ id, name: 'New goal', type: 'click', selector: '' });
  renderSettings();
  markDirty();
}

function selectVariant(id) {
  if (!current) return;
  activeVariantId = id;
  selected = null;
  pickMode = null;
  renderSettings();
  inspector.hidden = true;
  selectorInput.value = '';
  reloadPreview();
}

function currentVariant() {
  if (!current) return null;
  return current.variants.find((variant) => variant.id === activeVariantId) || current.variants[0] || null;
}

function renderExperimentList() {
  experimentList.innerHTML = experiments.map((exp) => `
    <li>
      <button type="button" data-experiment="${esc(exp.id)}" aria-current="${current && current.id === exp.id}">
        <span class="status-dot ${esc(exp.status)}" aria-hidden="true"></span>
        <span class="exp-name">${esc(exp.name || exp.id)}</span>
      </button>
    </li>
  `).join('');
  experimentList.querySelectorAll('[data-experiment]').forEach((button) => {
    button.addEventListener('click', () => loadExperiment(button.dataset.experiment));
  });
}

/* ------------------------------------------------------------------ */
/* Preview iframe                                                      */
/* ------------------------------------------------------------------ */

function reloadPreview() {
  frameBound = false;
  selected = null;
  inspector.hidden = true;
  selectorInput.value = '';
  updateHint('Click any element in the preview to select it. Enter/Space works when an element is focused.');
  frame.src = `/?splittag_editor=1&_=${Date.now()}`;
}

function bindFrame() {
  if (frameBound) return;
  const doc = frame.contentDocument;
  if (!doc || !doc.documentElement) return;
  frameBound = true;

  const style = doc.createElement('style');
  style.id = 'splittag-editor-highlight';
  style.textContent = `
    .splittag-editor-hover { outline: 3px dashed #d97706 !important; outline-offset: 2px !important; cursor: crosshair !important; }
    .splittag-editor-selected { outline: 3px solid #2563eb !important; outline-offset: 2px !important; }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  doc.addEventListener('click', onFrameClick, true);
  doc.addEventListener('mouseover', onFrameHover, true);
  doc.addEventListener('mouseout', onFrameHoverOut, true);
  doc.addEventListener('keydown', onFrameKeydown, true);

  clearSelection();
  applyActiveVariant(doc);
}

function applyActiveVariant(doc) {
  const variant = currentVariant();
  if (!variant) return;
  variant.changes.forEach((change) => {
    applyChangeToDocument(doc, change);
  });
}

function onFrameHover(event) {
  const target = event.target;
  if (!target || !target.classList) return;
  if (target === frame.contentDocument.body || target === frame.contentDocument.documentElement) return;
  target.classList.add('splittag-editor-hover');
}

function onFrameHoverOut(event) {
  if (event.target && event.target.classList) event.target.classList.remove('splittag-editor-hover');
}

function onFrameClick(event) {
  event.preventDefault();
  event.stopPropagation();
  const target = event.target;
  if (!target || target.nodeType !== 1) return;

  if (pickMode && pickMode.type === 'goal') {
    const selector = generateSelector(target);
    const goal = current.goals.find((item) => item.id === pickMode.goalId);
    if (goal && selector) {
      goal.selector = selector;
      pickMode = null;
      renderSettings();
      markDirty();
      updateHint(`Goal selector set to ${selector}.`);
    }
    return;
  }

  if (pickMode && pickMode.type === 'move') {
    if (!selected) {
      updateHint('Select the element to move first.', true);
      return;
    }
    const reference = generateSelector(target);
    if (reference && reference !== selected.selector) {
      const change = { type: 'move', selector: selected.selector };
      if (pickMode.position === 'before') change.beforeSelector = reference;
      else change.afterSelector = reference;
      pickMode = null;
      addChange(change);
      updateHint(`Move recorded: ${selected.selector} ${change.beforeSelector ? 'before' : 'after'} ${reference}.`);
    }
    return;
  }

  selectElement(target);
}

function onFrameKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target;
  if (!target || target.nodeType !== 1) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  event.preventDefault();
  event.stopPropagation();
  if (pickMode) onFrameClick({ target, preventDefault() {}, stopPropagation() {} });
  else selectElement(target);
}

function selectBySelector() {
  const doc = frame.contentDocument;
  if (!doc) return;
  const selector = selectorInput.value.trim();
  if (!selector) return;
  let element;
  try {
    element = doc.querySelector(selector);
  } catch (err) {
    updateHint('That is not a valid CSS selector.', true);
    return;
  }
  if (!element) {
    updateHint('No element matches that selector.', true);
    return;
  }
  selectElement(element, selector);
}

function selectElement(element, presetSelector) {
  if (!element || !element.classList) return;
  const doc = frame.contentDocument;
  doc.querySelectorAll('.splittag-editor-selected').forEach((node) => node.classList.remove('splittag-editor-selected'));
  element.classList.add('splittag-editor-selected');
  const selector = presetSelector || generateSelector(element);
  selected = { element, selector };
  inspector.hidden = false;
  selectedSelectorEl.textContent = selector;
  selectorInput.value = selector;
  updateHint('Element selected. Choose a mutation below; it is saved into the active variant.');

  $('text-input').value = (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 600);
  $('html-input').value = (element.innerHTML || '').slice(0, 3000);
  const computed = doc.defaultView.getComputedStyle(element);
  $('style-color').value = computed.color || '';
  $('style-background').value = computed.backgroundColor || '';
  $('style-fontsize').value = computed.fontSize || '';
  $('style-padding').value = computed.padding || '';
  $('class-add').value = '';
  $('class-remove').value = '';
  $('attr-name').value = '';
  $('attr-value').value = '';
}

function clearSelection() {
  selected = null;
  inspector.hidden = true;
  selectedSelectorEl.textContent = 'None';
  selectorInput.value = '';
  const doc = frame.contentDocument;
  if (doc) doc.querySelectorAll('.splittag-editor-selected').forEach((node) => node.classList.remove('splittag-editor-selected'));
}

/* ------------------------------------------------------------------ */
/* Recorded mutations                                                  */
/* ------------------------------------------------------------------ */

function applyText() {
  if (!selected) return;
  addChange({ type: 'text', selector: selected.selector, value: $('text-input').value });
}

function applyHtml() {
  if (!selected) return;
  addChange({ type: 'html', selector: selected.selector, value: $('html-input').value });
}

function applyStyle() {
  if (!selected) return;
  const props = {};
  const color = $('style-color').value.trim();
  const background = $('style-background').value.trim();
  const fontSize = $('style-fontsize').value.trim();
  const padding = $('style-padding').value.trim();
  if (color) props.color = color;
  if (background) props['background-color'] = background;
  if (fontSize) props['font-size'] = fontSize;
  if (padding) props.padding = padding;
  if (Object.keys(props).length === 0) {
    updateHint('Enter at least one style value.', true);
    return;
  }
  addChange({ type: 'style', selector: selected.selector, props });
}

function applyClass() {
  if (!selected) return;
  const add = splitClasses($('class-add').value);
  const remove = splitClasses($('class-remove').value);
  if (add.length === 0 && remove.length === 0) {
    updateHint('Enter at least one class to add or remove.', true);
    return;
  }
  addChange({ type: 'class', selector: selected.selector, add, remove });
}

function applyHide() {
  if (!selected) return;
  addChange({ type: 'hide', selector: selected.selector });
}

function applyAttr() {
  if (!selected) return;
  const name = $('attr-name').value.trim();
  if (!name) {
    updateHint('Enter an attribute name.', true);
    return;
  }
  addChange({ type: 'attr', selector: selected.selector, name, value: $('attr-value').value });
}

function armMove(position) {
  if (!selected) {
    updateHint('Select an element to move first.', true);
    return;
  }
  pickMode = { type: 'move', position };
  updateHint(`Click the reference element to place “${selected.selector}” ${position} it.`, true);
}

function addChange(change) {
  const variant = currentVariant();
  if (!variant) return;
  variant.changes.push(change);
  applyChangeToDocument(frame.contentDocument, change);
  renderSettings();
  markDirty();
  syncJson();
  inspector.hidden = false;
}

function removeChange(variantId, index) {
  const variant = current.variants.find((item) => item.id === variantId);
  if (!variant) return;
  variant.changes.splice(index, 1);
  renderSettings();
  markDirty();
  syncJson();
  if (variantId === activeVariantId) reloadPreview();
}

function splitClasses(value) {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function uniqueId(prefix, existing) {
  let index = 1;
  while (existing.includes(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/* ------------------------------------------------------------------ */
/* JSON, dirty state, hints                                            */
/* ------------------------------------------------------------------ */

function toggleJson() {
  const isHidden = jsonDrawer.hidden;
  jsonDrawer.hidden = !isHidden;
  $('json-toggle').setAttribute('aria-expanded', String(isHidden));
  if (isHidden) syncJson();
}

function syncJson() {
  if (!jsonDrawer.hidden || !current) return;
  jsonView.textContent = JSON.stringify(current, null, 2);
}

function markDirty() {
  updateIndicator();
}

function isDirty() {
  if (!current) return false;
  if (isNew) return true;
  return JSON.stringify(current) !== savedSnapshot;
}

function updateIndicator(forcedState, forcedText) {
  if (forcedState) {
    setIndicator(forcedState, forcedText);
    return;
  }
  if (isDirty()) setIndicator('dirty', 'Unsaved changes');
  else setIndicator('saved', 'All changes saved');
}

function setIndicator(state, text) {
  saveIndicator.dataset.state = state;
  saveIndicator.textContent = text;
}

function updateHint(text, picking) {
  selectionHint.textContent = text;
  selectionHint.classList.toggle('picking', Boolean(picking));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
