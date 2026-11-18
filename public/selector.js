/**
 * Robust CSS selector generation for the visual editor.
 * @module public/selector
 */

const PREFERRED_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'aria-label', 'name'];

function escapeIdent(value) {
  const string = String(value);
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(string);
  return string.replace(/([^a-zA-Z0-9_-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');
}

function unique(doc, selector, element) {
  try {
    const matches = doc.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch (err) {
    return false;
  }
}

function attributeSelector(name, value) {
  return `[${name}="${String(value).replace(/["\\]/g, '\\$&')}"]`;
}

function nthOfType(element) {
  const parent = element.parentElement;
  if (!parent) return null;
  const tag = element.tagName.toLowerCase();
  const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  if (siblings.length === 1) return tag;
  return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
}

/**
 * Build a selector that resolves uniquely back to `element`.
 *
 * Preference order:
 *   1. a unique id
 *   2. a unique stable data attribute (or aria-label/name)
 *   3. a unique tag + class combination
 *   4. an nth-of-type path from the nearest uniquely identifiable ancestor
 *
 * @param {Element} element
 * @returns {string|null}
 */
export function generateSelector(element) {
  if (!element || element.nodeType !== 1) return null;
  const doc = element.ownerDocument;
  if (!doc) return null;

  if (element.id) {
    const idSelector = '#' + escapeIdent(element.id);
    if (unique(doc, idSelector, element)) return idSelector;
  }

  for (const attr of PREFERRED_ATTRS) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const selector = attributeSelector(attr, value);
    if (unique(doc, selector, element)) return selector;
  }

  const classes = Array.from(element.classList || []).filter((name) => !/^splittag-/.test(name));
  if (classes.length > 0) {
    const classSelector = element.tagName.toLowerCase() + '.' + classes.map(escapeIdent).join('.');
    if (unique(doc, classSelector, element)) return classSelector;
  }

  const path = [];
  let current = element;
  while (current && current.nodeType === 1 && current !== doc.documentElement) {
    if (current.id) {
      const idSelector = '#' + escapeIdent(current.id);
      if (unique(doc, idSelector, current)) {
        path.unshift(idSelector);
        break;
      }
    }
    const fragment = nthOfType(current);
    if (!fragment) break;
    path.unshift(fragment);
    const candidate = path.join(' > ');
    if (unique(doc, candidate, element)) return candidate;
    current = current.parentElement;
  }

  const fallback = path.length ? path.join(' > ') : null;
  if (fallback && unique(doc, fallback, element)) return fallback;
  return fallback || element.tagName.toLowerCase();
}

/**
 * Apply a SplitTag change object to a live DOM. Shared by the editor's WYSIWYG
 * iframe and available to tests/utilities.
 * @param {Document} doc
 * @param {object} change
 * @returns {boolean} whether all required targets were found
 */
export function applyChangeToDocument(doc, change) {
  if (!doc || !change || !change.selector) return false;

  if (change.type === 'style') {
    const decl = Object.entries(change.props || {})
      .map(([prop, value]) => `${prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${value} !important`)
      .join(';');
    return injectRules(doc, `${change.selector}{${decl};}`);
  }
  if (change.type === 'hide') {
    return injectRules(doc, `${change.selector}{display:none !important;}`);
  }

  let nodes;
  try {
    nodes = doc.querySelectorAll(change.selector);
  } catch (err) {
    return false;
  }

  if (change.type === 'move') {
    const target = nodes[0];
    let reference = null;
    try {
      reference = change.beforeSelector
        ? doc.querySelector(change.beforeSelector)
        : doc.querySelector(change.afterSelector);
    } catch (err) { reference = null; }
    if (!target || !reference || !reference.parentNode) return false;
    if (change.beforeSelector) reference.parentNode.insertBefore(target, reference);
    else reference.parentNode.insertBefore(target, reference.nextSibling);
    return true;
  }

  if (nodes.length === 0) return false;

  nodes.forEach((node) => {
    if (change.type === 'text') node.textContent = change.value;
    else if (change.type === 'html') node.innerHTML = change.value;
    else if (change.type === 'attr') node.setAttribute(change.name, change.value);
    else if (change.type === 'class') {
      (change.remove || []).forEach((name) => node.classList.remove(name));
      (change.add || []).forEach((name) => node.classList.add(name));
    }
  });
  return true;
}

function injectRules(doc, css) {
  let tag = doc.getElementById('splittag-editor-styles');
  if (!tag) {
    tag = doc.createElement('style');
    tag.id = 'splittag-editor-styles';
    (doc.head || doc.documentElement).appendChild(tag);
  }
  tag.textContent += css + '\n';
  return true;
}
