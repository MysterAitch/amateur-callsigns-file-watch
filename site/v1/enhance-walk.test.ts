// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerComponent, registeredComponents, enhanceWithin } from './enhance-walk.js';

// The component registry and load-time enhance walk (issue #966; ADR 0022).
// Static HTML is authoritative and enhancement is additive, so the walk's most
// important property is what happens when an island misbehaves: the page — and
// every other island — must survive it, still stating the same figures. Test
// names follow Subject_Scenario_Outcome.

afterEach(() => { vi.restoreAllMocks(); });

function host(...names: string[]): HTMLElement {
  const root = document.createElement('div');
  for (const name of names) {
    const section = document.createElement('section');
    section.setAttribute('data-component', name);
    root.appendChild(section);
  }
  document.body.replaceChildren(root);
  return root;
}

describe('v1 enhance walk — registration', { tags: ['unit'] }, () => {
  it('RegisterComponent_AModuleWithNoEnhance_FailsLoudRatherThanRegisteringASilentGap', () => {
    expect(() => registerComponent('no-enhance', {} as never)).toThrow(/must export enhance/);
  });

  it('RegisteredComponents_AfterRegistration_NamesTheComponentForTheBuildTimeAssertion', () => {
    registerComponent('registry-probe', { enhance: () => {} });
    expect(registeredComponents()).toContain('registry-probe');
  });
});

describe('v1 enhance walk — the walk', { tags: ['ui'] }, () => {
  it('EnhanceWithin_EachComponentRoot_RunsItsEnhancerOnThatSubtreeAlone', () => {
    const seen: (HTMLElement | null)[] = [];
    registerComponent('scoped', { enhance: (root) => { seen.push(root); } });
    const root = host('scoped', 'scoped');
    enhanceWithin(root);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]?.getAttribute('data-component')).toBe('scoped');
  });

  it('EnhanceWithin_RunTwiceOverTheSameSubtree_EnhancesEachRootOnlyOnce', () => {
    let calls = 0;
    registerComponent('idempotent', { enhance: () => { calls += 1; } });
    const root = host('idempotent');
    enhanceWithin(root);
    enhanceWithin(root);
    expect(calls).toBe(1);
  });

  it('EnhanceWithin_ASubtreeInsertedAfterLoad_IsStillEnhancedWhenTheWalkIsRerun', () => {
    let calls = 0;
    registerComponent('rerunnable', { enhance: () => { calls += 1; } });
    const root = host('rerunnable');
    enhanceWithin(root);
    const added = document.createElement('section');
    added.setAttribute('data-component', 'rerunnable');
    root.appendChild(added);
    enhanceWithin(root);
    expect(calls).toBe(2);
  });

  it('EnhanceWithin_AnUnknownComponentName_IsASafeNoOpAndNeverReachesObjectPrototype', () => {
    // A name nobody registered must not upgrade anything and must not resolve
    // through the prototype chain to something that looks callable.
    const root = host('never-registered', 'toString', 'constructor');
    expect(() => enhanceWithin(root)).not.toThrow();
    expect(enhanceWithin(root).enhanced).toEqual([]);
  });

  it('EnhanceWithin_WhenOneIslandThrows_TheOthersStillEnhanceAndThePageSurvives', () => {
    // Error isolation is the point: a throwing enhancer degrades ITS island to
    // the static form the page was served with, and nothing else.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerComponent('throws', { enhance: () => { throw new Error('island failure'); } });
    let survivorRan = false;
    registerComponent('survivor', { enhance: () => { survivorRan = true; } });
    const root = host('throws', 'survivor');
    const result = enhanceWithin(root);
    expect(result.failed).toEqual(['throws']);
    expect(result.enhanced).toEqual(['survivor']);
    expect(survivorRan).toBe(true);
    // The failure is reported rather than swallowed — a silent no-op would be
    // worse than the throw.
    expect(console.error).toHaveBeenCalled();
  });

  it('EnhanceWithin_AFailedIsland_KeepsItsServedContentIntact', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerComponent('throws-late', {
      enhance: (root) => {
        root.appendChild(document.createElement('span'));
        throw new Error('failed after touching the DOM');
      },
    });
    const root = host('throws-late');
    const island = root.firstElementChild;
    island?.appendChild(document.createTextNode('served figure'));
    enhanceWithin(root);
    expect(island?.textContent).toContain('served figure');
  });
});
