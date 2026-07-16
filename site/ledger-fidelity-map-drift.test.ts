// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  FLAG_NOTES,
  RULE_GLOSSES,
  NOTABLE_PARSE_STATUS,
  fidelityOf,
  segmentsText,
} from './ledger-query.js';
import {
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  CALLSIGN_PATTERN_RULE,
  LICENCE_CATEGORY_RULE,
  STRIPPED_COLLISION_RULE,
} from '../src/v2/claim.ts';
import { PARSE_CALLSIGN_RULE } from '../src/v2/parse-attribute-emit.ts';

// Drift guard for the record-fidelity surface (issue #465; relates to #438, #398).
//
// site/ledger-query.js hand-mirrors the ledger's flag / rule / parse-status
// tokens in FLAG_NOTES, RULE_GLOSSES and NOTABLE_PARSE_STATUS, so a reader who
// looks up their callsign meets a plain-English gloss rather than raw jargon.
// Nothing structural ties those maps to the vocabulary the ledger actually
// emits, so a new or renamed token could silently surface with an empty gloss
// (FLAG_NOTES) or as its bare rule name (RULE_GLOSSES). These tests state the
// user-facing contract as an assertion: a token a reader can see must never
// surface as bare jargon. They key off the AUTHORITATIVE emitters, not a second
// hand-copied list, so the guard itself cannot quietly drift out of step.
//
// The three vocabularies have three DIFFERENT authoritative sources:
//   - flags: the closed registry in reference-data/flags.md, cross-checked
//     against the parser that raises them (components.ts). Every emitted flag
//     MUST have a note, because fidelityOf falls back to the bare flag token.
//   - rules: the named rule constants emitLedger attributes derived claims to
//     (claim.ts + parse-attribute-emit.ts). Every emitted rule MUST have a gloss,
//     because ruleGlossFor falls back to the bare rule name.
//   - parse statuses: the ParseStatus union in components.ts. Surfacing here is
//     deliberately SELECTIVE (only the "we could not read this" outcomes show),
//     so the map is NOT required to cover the whole vocabulary; the guard instead
//     holds it to a subset of real statuses and pins the vocabulary so a new
//     status forces a human to decide whether it must be surfaced.

const ROOT = path.resolve(__dirname, '..');
const FLAGS_REGISTRY = path.join(ROOT, 'reference-data', 'flags.md');
const COMPONENTS = path.join(ROOT, 'src', 'sources', 'ofcom-amateur', 'components.ts');

// The closed flag vocabulary as documented in the registry: the first-column
// token of every table row. The registry is THE source of truth ("everything a
// flag means lives here, once"), so reading it keeps this guard honest without a
// second hand-copied list.
function flagsFromRegistry(): string[] {
  const md = fs.readFileSync(FLAGS_REGISTRY, 'utf8');
  return [...md.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map(m => m[1]);
}

// The flag vocabulary the parser actually raises: every flag('token') it emits,
// plus the whole-source stripped-collision flag it appends separately. A flag
// that the parser raises but the registry omits (or vice versa) is a genuine
// drift the union below still forces the site map to cover.
function flagsFromParser(): string[] {
  const src = fs.readFileSync(COMPONENTS, 'utf8');
  const flags = new Set([...src.matchAll(/flag\('([a-z0-9-]+)'\)/g)].map(m => m[1]));
  flags.add('stripped-collision');
  return [...flags];
}

// The parser's closed parse-status vocabulary, read from its ParseStatus union.
function parseStatusesFromParser(): string[] {
  const src = fs.readFileSync(COMPONENTS, 'utf8');
  const union = src.match(/export type ParseStatus\s*=\s*([^;]+);/);
  if (union === null) throw new Error('could not locate the ParseStatus union in components.ts');
  return [...union[1].matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
}

// The named rules emitLedger (src/v2/claim.ts) attributes its derived claims to —
// the exact rule set the shipped claim-ledger carries. Imported as constants so a
// rename breaks the build here rather than silently slipping past the guard.
const EMITTED_RULES = [
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  CALLSIGN_PATTERN_RULE,
  LICENCE_CATEGORY_RULE,
  STRIPPED_COLLISION_RULE,
  PARSE_CALLSIGN_RULE,
];

const SRC = 'opendata/2025-06-04/raw.csv';
const V = '2025-06-04';
const RESOLVED = { typed: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', matched: 'cleaned' as const };

type Row = import('./ledger-query.js').ClaimRow;
function claimsRaisingFlag(flag: string): Row[] {
  return [
    { layer: 'raw', raw_subject: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: '@listed', object: '', rule: null, source_file: SRC, ordinal: 1, vintage: V },
    { layer: 'derived', raw_subject: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: 'flag', object: flag, rule: PARSE_CALLSIGN_RULE, source_file: SRC, ordinal: 1, vintage: V },
  ];
}
function claimsWithParseStatus(status: string): Row[] {
  return [
    { layer: 'raw', raw_subject: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: '@listed', object: '', rule: null, source_file: SRC, ordinal: 1, vintage: V },
    { layer: 'derived', raw_subject: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: 'parse_status', object: status, rule: PARSE_CALLSIGN_RULE, source_file: SRC, ordinal: 1, vintage: V },
  ];
}
const glossText = (segments: unknown): string => segmentsText(segments as never);

describe('fidelity-map drift guard — flags (#465)', { tags: ['ui'] }, () => {
  const registry = flagsFromRegistry();
  const parser = flagsFromParser();
  const emitted = [...new Set([...registry, ...parser])].sort();

  it('FlagRegistryAndParser_AgreeOnTheEmittedVocabulary', () => {
    // A sanity anchor: the two authoritative sources describe the SAME closed set.
    // If they diverge, the union below still guards the site map, but this names
    // the registry/parser drift directly.
    expect([...registry].sort()).toEqual([...parser].sort());
  });

  it('EveryEmittedFlag_HasASiteNote_SoNoReaderMeetsBareJargon', () => {
    const missing = emitted.filter(flag => !Object.prototype.hasOwnProperty.call(FLAG_NOTES, flag));
    expect(missing, `flags emitted by the ledger but absent from FLAG_NOTES: ${missing.join(', ')}`).toEqual([]);
  });

  it('EveryEmittedFlag_SurfacesWithARealLabelAndGloss', () => {
    // The user-facing contract, exercised end-to-end through fidelityOf: a claim
    // carrying each flag must produce a note whose label is human prose (not the
    // bare flag token) and whose gloss carries text. An unglossed flag would
    // surface as `{ label: <token>, gloss: '' }` — exactly the jargon we forbid.
    for (const flag of emitted) {
      const note = fidelityOf(claimsRaisingFlag(flag), RESOLVED).notes.find(n => n.id === flag);
      expect(note, `no note surfaced for flag "${flag}"`).toBeDefined();
      expect(note?.label, `flag "${flag}" surfaced its bare token as the label`).not.toBe(flag);
      expect(glossText(note?.gloss).trim().length, `flag "${flag}" surfaced an empty gloss`).toBeGreaterThan(0);
    }
  });

  it('NoSiteNote_GlossesAFlagTheLedgerNoLongerEmits', () => {
    // Inverse (clean because both sets are fully known): a stale FLAG_NOTES entry
    // for a retired flag is dead weight and a sign the mirror was not updated.
    const stale = Object.keys(FLAG_NOTES).filter(flag => !emitted.includes(flag));
    expect(stale, `FLAG_NOTES entries for flags the ledger no longer emits: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('fidelity-map drift guard — rules (#465)', { tags: ['ui'] }, () => {
  it('EveryEmittedRule_HasASiteGloss_SoNoWorkingShowsABareRuleName', () => {
    const missing = EMITTED_RULES.filter(rule => !Object.prototype.hasOwnProperty.call(RULE_GLOSSES, rule));
    expect(missing, `rules emitted by the ledger but absent from RULE_GLOSSES: ${missing.join(', ')}`).toEqual([]);
  });

  it('NoSiteGloss_DescribesARuleTheLedgerNoLongerEmits', () => {
    const stale = Object.keys(RULE_GLOSSES).filter(rule => !EMITTED_RULES.includes(rule));
    expect(stale, `RULE_GLOSSES entries for rules the ledger no longer emits: ${stale.join(', ')}`).toEqual([]);
  });

  it('SurfacedWorkings_ShowThePlainGlossNotTheBareRuleToken', () => {
    // The subset of rules a fidelity working can actually display, exercised
    // through fidelityOf: a divergent form's canonical working (cleaned-callsign),
    // a per-row flag's working (parse-callsign) and the stripped-collision flag's
    // own whole-source rule. Each working's ruleGloss must be prose, never the id.
    const divergent = fidelityOf([
      { layer: 'raw', raw_subject: 'g8xyz', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: '@listed', object: '', rule: null, source_file: SRC, ordinal: 1, vintage: V },
      { layer: 'derived', raw_subject: 'g8xyz', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: 'normalises_to', object: 'G8XYZ', rule: CLEANED_CALLSIGN_RULE, source_file: SRC, ordinal: 1, vintage: V },
    ], RESOLVED);
    const cleanedWorking = divergent.canonical?.variants[0]?.working;
    expect(cleanedWorking?.rule).toBe(CLEANED_CALLSIGN_RULE);
    expect(cleanedWorking?.ruleGloss).not.toBe(CLEANED_CALLSIGN_RULE);

    for (const rule of [PARSE_CALLSIGN_RULE, STRIPPED_COLLISION_RULE]) {
      const claims = [
        { layer: 'raw', raw_subject: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: '@listed', object: '', rule: null, source_file: SRC, ordinal: 1, vintage: V },
        { layer: 'derived', raw_subject: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', predicate: 'flag', object: 'stripped-collision', rule, source_file: SRC, ordinal: 1, vintage: V },
      ];
      const working = fidelityOf(claims, RESOLVED).notes.find(n => n.id === 'stripped-collision')?.working;
      expect(working?.rule).toBe(rule);
      expect(working?.ruleGloss, `rule "${rule}" surfaced its bare token`).not.toBe(rule);
    }
  });
});

describe('fidelity-map drift guard — parse statuses (#465)', { tags: ['ui'] }, () => {
  const emitted = parseStatusesFromParser();

  it('EveryNotableStatus_IsARealEmittedStatus', () => {
    // Inverse / dead-entry check: NOTABLE_PARSE_STATUS may cover only a subset
    // (selective disclosure), but every key it does carry must be a status the
    // parser really emits — otherwise the map glosses a status no reader can meet.
    const dead = Object.keys(NOTABLE_PARSE_STATUS).filter(status => !emitted.includes(status));
    expect(dead, `NOTABLE_PARSE_STATUS entries for statuses the parser does not emit: ${dead.join(', ')}`).toEqual([]);
  });

  it('TheEmittedVocabularyIsTheKnownClosedSet_SoANewStatusForcesAReview', () => {
    // The forward guard parse-status can have without over-reaching: the map is a
    // FILTER, so a new emitted status simply would not surface (never bare
    // jargon) — but it might be one a reader SHOULD see. Pinning the closed
    // vocabulary trips this test when the parser gains a status, prompting a human
    // to decide whether NOTABLE_PARSE_STATUS must gloss it.
    expect([...emitted].sort()).toEqual(
      ['empty', 'parsed', 'special-event', 'unparseable', 'visitor'],
    );
  });

  it('NotableStatuses_SurfaceWithARealLabelAndGloss', () => {
    for (const status of Object.keys(NOTABLE_PARSE_STATUS)) {
      const note = fidelityOf(claimsWithParseStatus(status), RESOLVED).notes.find(n => n.id === `parse-status-${status}`);
      expect(note, `no note surfaced for notable parse status "${status}"`).toBeDefined();
      expect(glossText(note?.gloss).trim().length, `parse status "${status}" surfaced an empty gloss`).toBeGreaterThan(0);
    }
  });

  it('ANonNotableStatus_IsNotSurfaced_KeepingDisclosureSelective', () => {
    const note = fidelityOf(claimsWithParseStatus('parsed'), RESOLVED).notes.find(n => n.id === 'parse-status-parsed');
    expect(note).toBeUndefined();
  });
});
