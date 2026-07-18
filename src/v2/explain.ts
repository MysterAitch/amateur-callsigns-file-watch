/**
 * Show the working behind every derived claim (issue #433, ADR 0017).
 *
 * Every derived claim in the raw-keyed ledger (#361) already names the RULE that
 * produced it (the how). The WORKING — the specific inputs it was computed from
 * and the transformation trace — is a pure function of data the ledger already
 * holds: the raw claim(s) of the SAME observation (source_file, ordinal), the
 * versioned reference-data/* rows, and (for the one cross-row rule) a sibling
 * observation. So the working is not stored; it is RECONSTRUCTED ON READ by a
 * per-rule dispatcher that RE-RUNS THE SAME lifted components.ts logic the emit
 * path used and returns a structured { inputs, steps, result }.
 *
 * The same-code guarantee is the point: because explain calls the same
 * cleanedCallsign / parseCallsign / normaliseLicenceCategory / callsignPattern
 * the emitter called, the shown working cannot diverge from the claim. A stored
 * copy of the derivation could drift; a reconstruction cannot. explain therefore
 * stores nothing extra, adds no claims or fields, and leaves the #404
 * no-inflation trace and the JSONL/N-Quads bytes literally untouched.
 *
 * Two rule families consume inputs beyond the same observation's raw claims;
 * explain RESOLVES — never stores — a pointer to them at read time:
 *   - reference-table rules (licence-category, and parse-callsign's implied_class
 *     via prefix-formats.csv and the forbidden-suffix flags via
 *     forbidden-suffixes.csv) return the matched reference-data row {file,key,row};
 *   - stripped-collision returns the sibling observation's key, found by re-running
 *     the same strip-and-membership test componentsFlagsForRows performs.
 *
 * fail loud: explaining a raw claim, or a claim whose rule this module does not
 * know, THROWS — an unexplainable derived claim is a surfaced gap, never a silent
 * blank. The clickable evidence chain (turning each origin into a #431 permalink)
 * and the JS-free "show working" disclosure are the surface's job (P4), deferred
 * to a follow-up; this module is the backend engine and its oracle only.
 */

import {
  cleanedCallsign,
  parseCallsign,
  normaliseLicenceCategory,
  isAfterFirstKnownForbidden,
  NON_PLAIN_RE,
  type ReferenceData,
  type PrefixSeriesInfo,
} from '../sources/ofcom-amateur/components.ts';
import { callsignPattern } from '../shared/stats.ts';
import {
  claimConfidence,
  LISTED_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  CALLSIGN_PATTERN_RULE,
  LICENCE_CATEGORY_RULE,
  STRIPPED_COLLISION_RULE,
  STRIPPED_COLLISION_FLAG,
  FLAG_PREDICATE,
  AUTHORED_EVENT_RULE,
  PARSE_CALLSIGN_RULE,
  PARSE_STATUS_PREDICATE,
  PREFIX_SERIES_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
  RSL_PREDICATE,
  type Claim,
  type ClaimConfidence,
} from './claim.ts';

// The two parse flags whose derivation consumes an input BEYOND the raw callsign
// token: a class-vs-product disagreement needs the observation's product cell,
// and the temporal after-first-known-list flag needs its original-start-date
// cell. Every other flag parseCallsign raises is a function of the token alone.
const CLASS_PRODUCT_MISMATCH_FLAG = 'class-product-mismatch';
const FORBIDDEN_AFTER_FIRST_KNOWN_FLAG = 'forbidden-suffix-issued-after-first-known-list';
const FORBIDDEN_SUFFIX_FLAG = 'forbidden-suffix';

// A single input a derivation consumed, tagged with WHERE it lives so a surface
// (P4) can turn `origin` into a #431 clickable source deep-link. `role` labels
// the input's part in the rule; `value` is the input's raw value; `origin` is the
// evidence locus, resolved at read time.
export interface WorkingInput {
  role: string;
  value: string;
  origin:
    // A raw claim of the SAME observation (its subject token, or an attribute
    // cell) — the join key is (sourceFile, ordinal, predicate).
    | { kind: 'raw-claim'; sourceFile: string; ordinal: number; predicate: string }
    // A resolved reference-data row — the small, versioned table the rule looked
    // the value up in. `row` is reconstructed from the loaded ReferenceData, so
    // explain performs no file I/O.
    | { kind: 'reference-row'; file: string; key: string; row: Record<string, string> }
    // Another observation in the SAME source — the sole cross-row evidence, the
    // stripped twin a stripped-collision flag witnesses.
    | { kind: 'sibling-observation'; sourceFile: string; ordinal: number }
    // An authored in-repo registry entry — the reviewed binding a Looked-up
    // value was asserted by (the authored-event vocabulary, issue #813 Stage
    // C2). Named by registry and keyed by the claim's own sourceFile, so a
    // surface can point at the binding's source rather than a reference CSV.
    | { kind: 'authored-binding'; registry: string; sourceFile: string };
}

// One human-readable transformation step, in derivation order. `from`/`to`
// optionally carry the value before and after the step.
export interface WorkingStep {
  detail: string;
  from?: string;
  to?: string;
}

// The full working behind ONE derived claim: the inputs it consumed, the ordered
// transformation trace, and the reproduced result. `result` is produced by
// CALLING THE LIFTED FUNCTION over the explained inputs, so `result` MUST equal
// the claim's object — that equality is the oracle (§7): a shown working that
// does not reproduce its claim is a fail-loud bug, never a display glitch.
export interface Working {
  claim: Claim;
  rule: string;
  ruleGloss: string;
  confidence: ClaimConfidence;
  inputs: WorkingInput[];
  steps: WorkingStep[];
  result: string;
}

// A plain-English gloss per rule. Engine-level and deliberately minimal: the P4
// affordance will source the reader-facing wording from the shared
// glossary/flags.md registry (#329) so it stays link-checked and single-sourced;
// this map only keeps explain self-describing without that surface in hand.
const RULE_GLOSSES: ReadonlyMap<string, string> = new Map([
  [CLEANED_CALLSIGN_RULE, 'Upper-cased and stripped to the plain callsign alphabet (A-Z, 0-9, /).'],
  [PLACEHOLDER_FORM_RULE, 'Parsed the callsign and dropped the Regional Secondary Locator to the # placeholder slot.'],
  [CALLSIGN_PATTERN_RULE, 'Mapped each character to its shape class (letter A, digit N, invisibles marked).'],
  [LICENCE_CATEGORY_RULE, 'Looked up the raw product value in the licence-category reference table.'],
  [PARSE_CALLSIGN_RULE, 'Computed by the callsign parser from the raw token (with the reference tables).'],
  [STRIPPED_COLLISION_RULE, 'The junk-stripped form coexists as its own row in the same source.'],
  [AUTHORED_EVENT_RULE, 'The event word is our authored reading of the disclosure\'s own covering-letter framing, not a published cell.'],
]);

function ruleGlossFor(rule: string): string {
  return RULE_GLOSSES.get(rule) ?? rule;
}

function codepoint(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

// The raw claims of the SAME observation as `claim` (same sourceFile + ordinal).
// The observation's original raw subject token, and every raw attribute cell,
// live here — the reconstructable inputs of every derived rule.
function sameObservationRawClaims(claim: Claim, ledger: readonly Claim[]): Claim[] {
  return ledger.filter(c =>
    c.layer === 'raw'
    && c.provenance.sourceFile === claim.provenance.sourceFile
    && c.provenance.ordinal === claim.provenance.ordinal);
}

// The @listed anchor of the observation — the raw claim that carries its original
// subject token verbatim. Every derived rule joins back to it, so its absence is
// a derived claim with no raw basis: fail loud (this is the #404 spine, surfaced).
function observationAnchor(claim: Claim, ledger: readonly Claim[]): Claim {
  const anchor = sameObservationRawClaims(claim, ledger).find(c => c.predicate === LISTED_PREDICATE);
  if (anchor === undefined) {
    throw new Error(`explain: no raw @listed anchor for observation ${claim.provenance.sourceFile}#${claim.provenance.ordinal} — a derived claim with no raw basis`);
  }
  return anchor;
}

// The WorkingInput for an observation's raw subject token, sourced from its
// @listed anchor claim.
function rawTokenInput(anchor: Claim): WorkingInput {
  return {
    role: 'raw-token',
    value: anchor.rawSubject,
    origin: { kind: 'raw-claim', sourceFile: anchor.provenance.sourceFile, ordinal: anchor.provenance.ordinal, predicate: anchor.predicate },
  };
}

// A resolved reference-data row for a prefix series (prefix-formats.csv). The row
// is reconstructed from the loaded ReferenceData, keyed by the bare prefix series.
function prefixReferenceInput(prefix: string, info: PrefixSeriesInfo): WorkingInput {
  return {
    role: 'prefix-row',
    value: info.stationLevel,
    origin: {
      kind: 'reference-row',
      file: 'prefix-formats.csv',
      key: prefix,
      row: { prefix, station_level: info.stationLevel, issuing_status: info.issuingStatus, rsl_required: String(info.rslRequired) },
    },
  };
}

// A resolved reference-data row for a forbidden suffix (forbidden-suffixes.csv),
// keyed by the suffix and carrying its first-known-forbidden date.
function forbiddenReferenceInput(suffix: string, firstKnown: string | undefined): WorkingInput {
  return {
    role: 'forbidden-row',
    value: firstKnown ?? '',
    origin: {
      kind: 'reference-row',
      file: 'forbidden-suffixes.csv',
      key: suffix,
      row: { suffix, first_known_forbidden: firstKnown ?? '' },
    },
  };
}

function buildWorking(claim: Claim, inputs: WorkingInput[], steps: WorkingStep[], result: string): Working {
  return {
    claim,
    rule: claim.rule ?? '',
    ruleGloss: ruleGlossFor(claim.rule ?? ''),
    confidence: claimConfidence(claim),
    inputs,
    steps,
    result,
  };
}

// ---- cleaned-callsign -------------------------------------------------------

function explainCleaned(claim: Claim, ledger: readonly Claim[]): Working {
  const anchor = observationAnchor(claim, ledger);
  const rawToken = anchor.rawSubject;
  const result = cleanedCallsign(rawToken);

  const steps: WorkingStep[] = [];
  const upper = rawToken.toUpperCase();
  if (upper !== rawToken) steps.push({ detail: 'upper-cased the token', from: rawToken, to: upper });
  const removed = [...upper].filter(ch => !/[A-Z0-9/]/.test(ch));
  if (removed.length > 0) {
    steps.push({
      detail: `removed ${removed.length} character(s) outside the plain alphabet A-Z0-9/ (${removed.map(codepoint).join(', ')})`,
      from: upper,
      to: result,
    });
  }
  if (steps.length === 0) steps.push({ detail: 'token already lies within A-Z0-9/; no change', from: rawToken, to: result });

  return buildWorking(claim, [rawTokenInput(anchor)], steps, result);
}

// ---- placeholder-form -------------------------------------------------------

function explainPlaceholder(claim: Claim, ledger: readonly Claim[], ref: ReferenceData): Working {
  const anchor = observationAnchor(claim, ledger);
  const rawToken = anchor.rawSubject;
  // The emit path computes the placeholder from the ORIGINAL raw token (the
  // parser cleans internally); reproducing it therefore consumes the raw token,
  // not the cleaned intermediate the claim happens to be subject-keyed on.
  const parsed = parseCallsign(rawToken, '', ref);
  const result = parsed.placeholderForm;

  const steps: WorkingStep[] = [
    { detail: `parsed the callsign (parse_status = ${parsed.parseStatus})`, from: rawToken },
    { detail: `split prefix series ${parsed.prefixSeries || '(none)'}, RSL ${parsed.rsl || '(none)'}, suffix ${parsed.suffix || '(none)'}` },
    { detail: 'dropped the RSL and inserted the # placeholder slot', to: result },
  ];

  return buildWorking(claim, [rawTokenInput(anchor)], steps, result);
}

// ---- callsign-pattern -------------------------------------------------------

function explainPattern(claim: Claim, ledger: readonly Claim[]): Working {
  const anchor = observationAnchor(claim, ledger);
  const rawToken = anchor.rawSubject;
  const result = callsignPattern(rawToken);
  const steps: WorkingStep[] = [
    { detail: 'mapped each character to its shape class (A-Z to A, a-z to a, 0-9 to N, invisibles to {U+XXXX})', from: rawToken, to: result },
  ];
  return buildWorking(claim, [rawTokenInput(anchor)], steps, result);
}

// ---- licence-category -------------------------------------------------------

function explainLicenceCategory(claim: Claim, ledger: readonly Claim[], ref: ReferenceData): Working {
  // Fail loud if the observation carries no raw basis (a #404 gap), even though
  // the licence-category working reads its inputs from the product cell below.
  observationAnchor(claim, ledger);
  // The product cell is the raw attribute claim of this observation whose value
  // maps — through the SAME normaliseLicenceCategory the emitter used — to the
  // claimed category. Resolving it this way reconstructs both which cell was the
  // product cell and the result, in one code path.
  const attributes = sameObservationRawClaims(claim, ledger).filter(c => c.predicate !== LISTED_PREDICATE);
  const productClaim = attributes.find(c => normaliseLicenceCategory(c.object, ref) === claim.object);
  if (productClaim === undefined) {
    throw new Error(`explain: licence-category claim ${claim.provenance.sourceFile}#${claim.provenance.ordinal} — no raw product cell in the same observation maps to "${claim.object}"`);
  }
  const key = productClaim.object.trim();
  const category = normaliseLicenceCategory(productClaim.object, ref);
  if (category === null) {
    // Unreachable given the find above, but the type is string | null; surface a
    // gap rather than coerce with the null-forgiving operator.
    throw new Error(`explain: licence-category reconstruction yielded no category for "${productClaim.object}"`);
  }

  const inputs: WorkingInput[] = [
    { role: 'product-cell', value: productClaim.object, origin: { kind: 'raw-claim', sourceFile: productClaim.provenance.sourceFile, ordinal: productClaim.provenance.ordinal, predicate: productClaim.predicate } },
    { role: 'category-row', value: category, origin: { kind: 'reference-row', file: 'licence-category.csv', key, row: { product: key, normalised_category: category } } },
  ];
  const steps: WorkingStep[] = [
    { detail: `read the product cell under column "${productClaim.predicate}"`, to: productClaim.object },
    { detail: `matched licence-category.csv row keyed "${key}"`, from: key, to: category },
  ];
  return buildWorking(claim, inputs, steps, category);
}

// ---- stripped-collision (the sole cross-row rule) ---------------------------

function explainStrippedCollision(claim: Claim, ledger: readonly Claim[]): Working {
  const anchor = observationAnchor(claim, ledger);
  const rawToken = anchor.rawSubject;
  const stripped = rawToken.replace(NON_PLAIN_RE, '');
  // Re-run the SAME strip-and-membership test componentsFlagsForRows performs:
  // the sibling is another observation in this source whose raw subject is this
  // token stripped to the plain alphabet.
  const sibling = ledger.find(c =>
    c.layer === 'raw'
    && c.predicate === LISTED_PREDICATE
    && c.provenance.sourceFile === claim.provenance.sourceFile
    && c.provenance.ordinal !== claim.provenance.ordinal
    && c.rawSubject === stripped);
  if (stripped === rawToken || stripped === '' || sibling === undefined) {
    throw new Error(`explain: stripped-collision claim ${claim.provenance.sourceFile}#${claim.provenance.ordinal} — no sibling observation whose raw subject is the stripped form "${stripped}"`);
  }

  const inputs: WorkingInput[] = [
    rawTokenInput(anchor),
    { role: 'sibling-observation', value: stripped, origin: { kind: 'sibling-observation', sourceFile: sibling.provenance.sourceFile, ordinal: sibling.provenance.ordinal } },
  ];
  const steps: WorkingStep[] = [
    { detail: 'stripped every character outside the plain alphabet A-Za-z0-9/#', from: rawToken, to: stripped },
    { detail: `the stripped form coexists as its own row in the same source (ordinal ${sibling.provenance.ordinal})` },
  ];
  return buildWorking(claim, inputs, steps, STRIPPED_COLLISION_FLAG);
}

// ---- parse-callsign fan-out -------------------------------------------------

function explainParse(claim: Claim, ledger: readonly Claim[], ref: ReferenceData): Working {
  const anchor = observationAnchor(claim, ledger);
  const rawToken = anchor.rawSubject;

  switch (claim.predicate) {
    case PARSE_STATUS_PREDICATE: {
      const parsed = parseCallsign(rawToken, '', ref);
      return buildWorking(claim, [rawTokenInput(anchor)], [
        { detail: `the parser resolved the token's callsign formation to "${parsed.parseStatus}"`, from: rawToken, to: parsed.parseStatus },
      ], parsed.parseStatus);
    }
    case PREFIX_SERIES_PREDICATE: {
      const parsed = parseCallsign(rawToken, '', ref);
      return buildWorking(claim, [rawTokenInput(anchor)], [
        { detail: 'the parser split the prefix series from the token', from: rawToken, to: parsed.prefixSeries },
      ], parsed.prefixSeries);
    }
    case RSL_PREDICATE: {
      const parsed = parseCallsign(rawToken, '', ref);
      return buildWorking(claim, [rawTokenInput(anchor)], [
        { detail: 'the parser split the Regional Secondary Locator from the token', from: rawToken, to: parsed.rsl },
      ], parsed.rsl);
    }
    case IMPLIED_CLASS_PREDICATE: {
      const parsed = parseCallsign(rawToken, '', ref);
      const info = ref.prefixSeries.get(parsed.prefixSeries);
      if (info === undefined) {
        throw new Error(`explain: implied_class claim — prefix series "${parsed.prefixSeries}" is absent from prefix-formats.csv`);
      }
      return buildWorking(claim, [rawTokenInput(anchor), prefixReferenceInput(parsed.prefixSeries, info)], [
        { detail: `prefix series ${parsed.prefixSeries} maps to station level "${info.stationLevel}" in prefix-formats.csv`, to: info.stationLevel },
      ], parsed.impliedClass);
    }
    case FLAG_PREDICATE:
      return explainFlag(claim, anchor, ledger, ref);
    default:
      throw new Error(`explain: unknown parse-callsign predicate "${claim.predicate}"`);
  }
}

function explainFlag(claim: Claim, anchor: Claim, ledger: readonly Claim[], ref: ReferenceData): Working {
  const rawToken = anchor.rawSubject;
  const flagName = claim.object;
  const attributes = sameObservationRawClaims(claim, ledger).filter(c => c.predicate !== LISTED_PREDICATE);

  // class-product-mismatch consumes the product cell: the attribute cell that,
  // fed to the SAME parser, raises the flag. Resolving it by re-running the
  // parser keeps the reconstruction on one code path (no second copy of
  // productClass).
  if (flagName === CLASS_PRODUCT_MISMATCH_FLAG) {
    const productClaim = attributes.find(c => parseCallsign(rawToken, c.object, ref).flags.includes(CLASS_PRODUCT_MISMATCH_FLAG));
    if (productClaim === undefined) {
      throw new Error(`explain: class-product-mismatch claim — no product cell reproduces the flag for token "${rawToken}"`);
    }
    const parsed = parseCallsign(rawToken, productClaim.object, ref);
    const info = ref.prefixSeries.get(parsed.prefixSeries);
    if (info === undefined) {
      throw new Error(`explain: class-product-mismatch claim — prefix series "${parsed.prefixSeries}" is absent from prefix-formats.csv`);
    }
    const inputs: WorkingInput[] = [
      rawTokenInput(anchor),
      { role: 'product-cell', value: productClaim.object, origin: { kind: 'raw-claim', sourceFile: productClaim.provenance.sourceFile, ordinal: productClaim.provenance.ordinal, predicate: productClaim.predicate } },
      prefixReferenceInput(parsed.prefixSeries, info),
    ];
    const steps: WorkingStep[] = [
      { detail: `prefix series ${parsed.prefixSeries} implies station level "${parsed.impliedClass}"` },
      { detail: `the product cell "${productClaim.object}" declares a different class` },
      { detail: 'implied class and product-declared class disagree' },
    ];
    return buildWorking(claim, inputs, steps, flagName);
  }

  // forbidden-suffix-issued-after-first-known-list consumes the original-start-
  // date cell: the attribute cell that, fed to the SAME parser, raises the flag.
  if (flagName === FORBIDDEN_AFTER_FIRST_KNOWN_FLAG) {
    const dateClaim = attributes.find(c => parseCallsign(rawToken, '', ref, c.object).flags.includes(FORBIDDEN_AFTER_FIRST_KNOWN_FLAG));
    if (dateClaim === undefined) {
      throw new Error(`explain: ${FORBIDDEN_AFTER_FIRST_KNOWN_FLAG} claim — no original-start-date cell reproduces the flag for token "${rawToken}"`);
    }
    const suffix = parseCallsign(rawToken, '', ref).suffix;
    const firstKnown = ref.forbiddenSuffixFirstKnown.get(suffix);
    const inputs: WorkingInput[] = [
      rawTokenInput(anchor),
      { role: 'original-start-date', value: dateClaim.object, origin: { kind: 'raw-claim', sourceFile: dateClaim.provenance.sourceFile, ordinal: dateClaim.provenance.ordinal, predicate: dateClaim.predicate } },
      forbiddenReferenceInput(suffix, firstKnown),
    ];
    const afterFirstKnown = isAfterFirstKnownForbidden(dateClaim.object, firstKnown);
    const steps: WorkingStep[] = [
      { detail: `suffix ${suffix} was first known forbidden ${firstKnown ?? '(unknown)'}` },
      { detail: `original start date "${dateClaim.object}" falls in a month strictly after that (${afterFirstKnown})` },
    ];
    return buildWorking(claim, inputs, steps, flagName);
  }

  // Every other flag is a function of the raw token alone; the parser over the
  // bare token reproduces it.
  const parsed = parseCallsign(rawToken, '', ref);
  if (!parsed.flags.includes(flagName)) {
    throw new Error(`explain: flag "${flagName}" is not reproduced by the parser over the raw token "${rawToken}" — an unexplainable flag`);
  }
  const inputs: WorkingInput[] = [rawTokenInput(anchor)];
  if (flagName === FORBIDDEN_SUFFIX_FLAG) {
    inputs.push(forbiddenReferenceInput(parsed.suffix, ref.forbiddenSuffixFirstKnown.get(parsed.suffix)));
  }
  return buildWorking(claim, inputs, [
    { detail: `the parser raised "${flagName}" for the token`, from: rawToken, to: flagName },
  ], flagName);
}

// ---- authored-event (issue #813 Stage C2) -----------------------------------

// The working behind an authored-event claim. There is nothing to COMPUTE: the
// event word is asserted by the authored converter binding
// (FOI_ENTRY_CONVERSIONS, foi-normalise.ts), which pins one word per disclosure
// from its covering letter's own framing - a registry LOOKUP, so the claim
// reads out Looked-up. What IS re-checkable from the ledger alone is checked:
// the claim's observation must have a raw @listed anchor (fail loud via
// observationAnchor - no invented subjects), and the per-source constancy the
// binding guarantees must hold - every authored-event claim of the same source
// carries the SAME word, so a mixed vocabulary (which the binding cannot
// produce) fails loudly rather than explaining away.
function explainAuthoredEvent(claim: Claim, ledger: readonly Claim[]): Working {
  const anchor = observationAnchor(claim, ledger);
  const siblings = ledger.filter(c => c.layer === 'derived' && c.rule === AUTHORED_EVENT_RULE);
  const words = new Set(siblings.map(c => c.object));
  if (words.size !== 1) {
    throw new Error(`explain: authored-event claims of ${claim.provenance.sourceFile} carry ${words.size} distinct event words (${[...words].join(', ')}) - the authored binding pins exactly one per source`);
  }
  const inputs: WorkingInput[] = [
    rawTokenInput(anchor),
    {
      role: 'authored-event-word',
      value: claim.object,
      origin: { kind: 'authored-binding', registry: 'FOI_ENTRY_CONVERSIONS', sourceFile: claim.provenance.sourceFile },
    },
  ];
  return buildWorking(claim, inputs, [
    { detail: 'the authored converter binding pins this source\'s event vocabulary from the disclosure\'s covering-letter wording', to: claim.object },
  ], claim.object);
}

// ---- the dispatcher ---------------------------------------------------------

// Reconstruct the working behind a derived claim. `ledger` is the claims of the
// SAME source (already in hand when rendering a source/observation); `ref` is the
// loaded reference data. Pure: same inputs -> same Working. Throws (fail loud) if
// asked to explain a raw claim or a rule it does not know — an unexplainable
// derived claim is a gap to surface, never a silent blank.
export function explain(claim: Claim, ledger: readonly Claim[], ref: ReferenceData): Working {
  if (claim.layer !== 'derived') {
    throw new Error(`explain: ${claim.provenance.sourceFile}#${claim.provenance.ordinal}:${claim.predicate} is a raw claim — only derived claims carry a working`);
  }
  const rule = claim.rule;
  if (rule === undefined || rule === '') {
    throw new Error(`explain: derived claim ${claim.provenance.sourceFile}#${claim.provenance.ordinal}:${claim.predicate} carries no rule — its production method is unattributable`);
  }
  // A source's own claims are the reconstruction context; guard against a caller
  // passing a wider corpus by narrowing to the claim's source once, up front.
  const sameSource = ledger.filter(c => c.provenance.sourceFile === claim.provenance.sourceFile);

  switch (rule) {
    case CLEANED_CALLSIGN_RULE: return explainCleaned(claim, sameSource);
    case PLACEHOLDER_FORM_RULE: return explainPlaceholder(claim, sameSource, ref);
    case CALLSIGN_PATTERN_RULE: return explainPattern(claim, sameSource);
    case LICENCE_CATEGORY_RULE: return explainLicenceCategory(claim, sameSource, ref);
    case STRIPPED_COLLISION_RULE: return explainStrippedCollision(claim, sameSource);
    case AUTHORED_EVENT_RULE: return explainAuthoredEvent(claim, sameSource);
    case PARSE_CALLSIGN_RULE: return explainParse(claim, sameSource, ref);
    default:
      throw new Error(`explain: unknown rule "${rule}" on ${claim.provenance.sourceFile}#${claim.provenance.ordinal}:${claim.predicate} — an unexplainable derived claim`);
  }
}
