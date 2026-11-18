import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { generateSelector, applyChangeToDocument } from '../../public/selector.js';

function fixture() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <main id="app">
      <h1 id="hero-headline" class="hero-title">Hello students</h1>
      <section class="benefits" id="benefits">
        <article class="benefit-card"><h3>One</h3><p>First benefit</p></article>
        <article class="benefit-card"><h3>Two</h3><p>Second benefit</p></article>
      </section>
      <ul id="list"><li>alpha</li><li data-testid="second">beta</li><li>gamma</li></ul>
      <form id="lead-form"><label for="email">Email</label><input id="email" name="email"><button type="submit">Go</button></form>
      <div class="a b">x</div><div class="a">y</div>
      <p><span>one</span><span>two</span><span>three</span></p>
      <div id="dup">first duplicate</div><div id="dup">second duplicate</div>
    </main>
  </body></html>`, { url: 'http://localhost/' });
  return dom.window.document;
}

test('every generated selector uniquely resolves to its element', () => {
  const doc = fixture();
  const elements = Array.from(doc.querySelectorAll('body *'));
  assert.ok(elements.length > 20);
  for (const element of elements) {
    const selector = generateSelector(element);
    assert.ok(selector, `selector for ${element.tagName}`);
    const resolved = doc.querySelector(selector);
    assert.equal(resolved, element, `${selector} resolved to the wrong element`);
  }
});

test('generation prefers a unique id, then a unique data attribute', () => {
  const doc = fixture();
  assert.equal(generateSelector(doc.getElementById('hero-headline')), '#hero-headline');
  assert.equal(generateSelector(doc.querySelector('[data-testid="second"]')), '[data-testid="second"]');
});

test('duplicate ids fall through to a positional path that is still unique', () => {
  const doc = fixture();
  const duplicates = doc.querySelectorAll('#dup');
  assert.equal(duplicates.length, 2);
  const selector = generateSelector(duplicates[1]);
  assert.notEqual(selector, '#dup');
  assert.equal(doc.querySelector(selector), duplicates[1]);
});

test('class and nth-of-type paths resolve for repeated cards', () => {
  const doc = fixture();
  const cards = doc.querySelectorAll('.benefit-card');
  const first = generateSelector(cards[0]);
  const second = generateSelector(cards[1]);
  assert.equal(doc.querySelector(first), cards[0]);
  assert.equal(doc.querySelector(second), cards[1]);
  assert.notEqual(first, second);
});

test('applyChangeToDocument applies text, style, hide, class, attr, and move changes', () => {
  const doc = fixture();
  const p = doc.querySelector('section.benefits p');
  applyChangeToDocument(doc, { type: 'text', selector: 'section.benefits p', value: 'changed' });
  assert.equal(p.textContent, 'changed');
  applyChangeToDocument(doc, { type: 'class', selector: '#hero-headline', add: ['loud'], remove: ['hero-title'] });
  assert.ok(doc.getElementById('hero-headline').classList.contains('loud'));
  assert.ok(!doc.getElementById('hero-headline').classList.contains('hero-title'));
  applyChangeToDocument(doc, { type: 'attr', selector: '#hero-headline', name: 'data-x', value: 'yes' });
  assert.equal(doc.getElementById('hero-headline').getAttribute('data-x'), 'yes');
  applyChangeToDocument(doc, { type: 'style', selector: '#hero-headline', props: { color: '#ff0000' } });
  assert.match(doc.getElementById('splittag-editor-styles').textContent, /#ff0000/);
  applyChangeToDocument(doc, { type: 'hide', selector: '#list' });
  assert.match(doc.getElementById('splittag-editor-styles').textContent, /#list\{display:none/);
  applyChangeToDocument(doc, { type: 'move', selector: '#benefits', beforeSelector: '#hero-headline' });
  assert.equal(doc.getElementById('benefits').nextElementSibling, doc.getElementById('hero-headline'));
});
