import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { el, serialise, setBuildDocument } from './el.js';

// The Node build backend (issue #966, ADR 0022): the SAME el() codebase runs
// at build time against a jsdom document supplied via setBuildDocument. This
// file deliberately runs in the plain node environment (no jsdom test
// environment), so `document` is genuinely absent — proving the fail-loud path
// and the injected backend, exactly as src/ci/build-v1-chip.ts exercises them.
// Test names follow Subject_Scenario_Outcome.

describe('v1 el() foundation — Node build backend', { tags: ['unit'] }, () => {
  it('El_NodeBuildWithNoDocumentSupplied_FailsLoudNamingTheBackendCall', () => {
    expect(typeof document).toBe('undefined'); // the premise: a real Node build context
    expect(() => el('span')).toThrow(/setBuildDocument/);
  });

  it('El_NodeBuildWithJsdomBackend_BuildsAndSerialisesLikeTheBrowserIdiom', () => {
    setBuildDocument(new JSDOM('').window.document);
    const html = serialise(el('span', { class: 'chip asof', title: 't' }, 'a ', el('b', null, '1'), ' z'));
    expect(html).toBe('<span class="chip asof" title="t">a <b>1</b> z</span>');
  });

  it('El_NodeBuildGuards_StillFailLoudUnderTheBuildBackend', () => {
    setBuildDocument(new JSDOM('').window.document);
    expect(() => el('script')).toThrow(/rawtext/);
    expect(() => el('div', { onclick: 'x' })).toThrow(/event-handler/);
    expect(el('a', { href: 'javascript:alert(1)' }, 'x').getAttribute('href')).toBe('#');
  });
});
