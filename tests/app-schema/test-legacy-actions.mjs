// test-legacy-actions.mjs — the director-only Legacy Actions panel.
//
// The gate is the point of this suite. It is a PRESENTATION gate, not a security boundary
// (the pages behind it are RLS-gated regardless), but a presentation gate that leaks is still
// a bug: it sends instructors to surfaces whose data and lifetime they should not have to
// reason about. So the negative cases matter more than the positive one.

import { check, eq, section, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/app/faculty/lessons.html' });

// mountLegacyActions writes to document.body, so give it just enough DOM to append into.
const made = [];
globalThis.document = {
  getElementById: (id) => made.find(n => n.id === id) || null,
  createElement: (tag) => {
    const node = {
      tagName: tag.toUpperCase(), id: '', className: '', innerHTML: '', children: [],
      _attrs: {}, _listeners: {},
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); },
      querySelector() { return { addEventListener() {}, setAttribute() {} }; },
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
        toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      },
    };
    return node;
  },
  body: { appendChild: (n) => { made.push(n); return n; } },
};

const { mountLegacyActions } = await import('../../site/app/js/nav.js');

const ITEMS = [{ href: 'interactions.html', label: 'Interaction reports', note: 'n', emoji: '💡' }];
const reset = () => { made.length = 0; };
const ctxOf = (isDirector) => ({ isDirectorForCurrent: () => isDirector });

section('the director gate');

reset();
mountLegacyActions(ctxOf(false), ITEMS);
eq('an instructor gets NO panel', made.length, 0);

reset();
mountLegacyActions({}, ITEMS);
eq('a context with no role resolver gets no panel', made.length, 0);

reset();
mountLegacyActions(ctxOf(true), ITEMS);
eq('a director gets the panel', made.length, 1);
check('…titled Legacy Actions', made[0].innerHTML.includes('Legacy Actions'));
check('…containing the item', made[0].innerHTML.includes('interactions.html'));

section('degenerate input');

reset();
mountLegacyActions(ctxOf(true), []);
eq('no items => no empty panel', made.length, 0);
reset();
mountLegacyActions(ctxOf(true));
eq('items omitted entirely => no panel', made.length, 0);

section('collapsed by default');

reset();
mountLegacyActions(ctxOf(true), ITEMS);
check('starts collapsed (findable, not present)', !made[0].className.includes('open'));
check('toggle reports its collapsed state to assistive tech',
      made[0].innerHTML.includes('aria-expanded="false"'));

section('escaping');

// Item labels are authored in page code today, but the panel must not become an injection
// point the moment someone feeds it a course or lesson title.
reset();
mountLegacyActions(ctxOf(true), [{ href: 'x.html', label: '<img src=x onerror=alert(1)>', note: '<b>n</b>' }]);
check('a label is HTML-escaped', !made[0].innerHTML.includes('<img src=x'));
check('a note is HTML-escaped', !made[0].innerHTML.includes('<b>n</b>'));

section('external links');

reset();
mountLegacyActions(ctxOf(true), [{ href: 'https://x/admin.html', label: 'Legacy admin', external: true }]);
check('an external item opens in a new tab', made[0].innerHTML.includes('target="_blank"'));
check('…with noopener', made[0].innerHTML.includes('rel="noopener"'));
