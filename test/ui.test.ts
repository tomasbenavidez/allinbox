import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderView } from '../src/ui.ts';

for (const name of ['search', 'draft'] as const) {
  test(`${name} view is one self-contained, offline HTML`, async () => {
    const html = await renderView(name);
    assert.ok(!html.includes('allinbox:bridge') && !html.includes('allinbox:base'), 'placeholders inlined');
    assert.match(html, /ui\/initialize/);
    assert.match(html, /ui\/notifications\/initialized/);
    assert.match(html, /--bg:/);
    // Nothing loaded from the network: no external scripts, styles, images or fetch.
    assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)=/i);
    assert.doesNotMatch(html, /\bfetch\(/);
    // Email-derived text must never be parsed as HTML.
    assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
}
