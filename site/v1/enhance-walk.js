// @ts-check
// v1 COMPONENT REGISTRY AND ENHANCE WALK (issue #966; ADR 0022). Static HTML is
// authoritative; behaviour arrives as islands of one-shot progressive
// enhancement over it. This module is the single load-time pass that finds
// those islands and upgrades them.
//
// The contract it enforces:
//   - a component root is marked `data-component="<name>"` by its own
//     renderStatic, and the walk queries `[data-component]` and runs the
//     registered enhancer on THAT SUBTREE ONLY — never a document-wide
//     selector, which would grab sibling instances;
//   - lookup is a Map, so an unknown `data-component` is a safe no-op and can
//     never reach Object.prototype;
//   - the walk is idempotent (an enhanced root is marked) and re-runnable on a
//     newly-inserted subtree, so anything a mutator inserts still gets enhanced;
//   - ERROR ISOLATION: each enhancer runs inside its own try/catch, so one
//     island throwing degrades that island to its static form and leaves every
//     other island — and the page — intact. A silent failure would be worse
//     than the throw, so the failure is reported to the console and the root is
//     marked as attempted rather than retried in a loop.
//
// The static HTML is the fallback for every failure mode here: an enhancer that
// never runs, or throws on its first line, leaves a page that still states the
// same figures.

/** @typedef {{ enhance: (root: HTMLElement) => void }} EnhanceableComponent */

/** @type {Map<string, EnhanceableComponent>} */
const REGISTRY = new Map();

/**
 * Register a component's enhancer under the `data-component` name its
 * renderStatic stamps. Registration verifies the module exposes `enhance`, so a
 * component wired into the registry without one is a loud error at load rather
 * than a silent gap at enhance time.
 * @param {string} name
 * @param {EnhanceableComponent} component
 * @returns {void}
 */
export function registerComponent(name, component) {
  if (typeof component.enhance !== 'function') {
    throw new Error(`registerComponent(${name}): a component must export enhance() — a written no-op where it has no behaviour, so "no enhancement" reads as an intentional statement`);
  }
  REGISTRY.set(name, component);
}

/**
 * The names registered so far. Read by the build-time assertion that every
 * emitted `data-component` has an enhancer behind it.
 * @returns {string[]}
 */
export function registeredComponents() {
  return [...REGISTRY.keys()].sort();
}

/**
 * Enhance every component root within (and including) `root`. Safe to call
 * again on the same subtree and on newly-inserted subtrees.
 * @param {HTMLElement | Document} root
 * @returns {{ enhanced: string[], failed: string[] }}
 */
export function enhanceWithin(root) {
  /** @type {string[]} */
  const enhanced = [];
  /** @type {string[]} */
  const failed = [];
  /** @type {HTMLElement[]} */
  const roots = [];
  if (root instanceof HTMLElement && root.dataset.component !== undefined) roots.push(root);
  for (const node of root.querySelectorAll('[data-component]')) {
    if (node instanceof HTMLElement) roots.push(node);
  }
  for (const node of roots) {
    const name = node.dataset.component ?? '';
    if (node.dataset.enhanced === '1') continue;
    const component = REGISTRY.get(name);
    if (component === undefined) continue; // an unregistered name is a safe no-op
    node.dataset.enhanced = '1';
    try {
      component.enhance(node);
      enhanced.push(name);
    } catch (error) {
      failed.push(name);
      console.error(`enhanceWithin: the "${name}" island failed to enhance and stays in its static form`, error);
    }
  }
  return { enhanced, failed };
}
