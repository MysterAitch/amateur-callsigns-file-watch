// @ts-check
// v1 DATED-FACT SOURCE OF TRUTH (issues #965, #966): the single place the
// "Record as of <date> · <n> publications held" figures are authored. The build
// step src/ci/build-v1-chip.ts REWRITES this one literal at deploy from the
// build-derived holdings manifest (_site/holdings.json), and the shared site bar
// (site/v1/shell.js) reads it as the sole facts source — so every v1 page shows
// one build-derived figure and no page re-authors or re-passes the value.
//
// This is the define-once primitive: the date + count are derived in exactly one
// place (the holdings manifest) and consumed by the single shared chip component.
// The static-HTML no-JS baselines mirror it (stamped by the same build step for
// crawler visibility) and are held to it by the cross-page parity test
// (site/v1/sections.test.ts), the backstop for the one copy that cannot be
// de-duplicated without server-rendering the shell.
//
// The committed value below is the current deploy's figure and serves only as a
// default for local viewing; the deploy always overwrites it from the manifest.

/** @typedef {{ date: string, count: number }} RecordFacts */

/** @type {RecordFacts} */
export const RECORD_FACTS = { date: '23 June 2026', count: 65 };
