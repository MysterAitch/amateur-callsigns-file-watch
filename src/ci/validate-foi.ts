/**
 * FOI-lane structural validation (ADR 0004 point 4; issue #149 Phase A).
 *
 * The merge gate for archive/foi/ entries, run inside `validate:data` (the
 * required data-validation CI check): meta.json shape and vocabularies,
 * referential integrity (converter bindings, derivation references, sibling
 * entry links), and byte integrity - every declared file hash-checked on
 * every run, every on-disk file declared.
 *
 * Purely structural/referential by design: whether derivations still
 * REPRODUCE is verified per-PR by the golden-master tests and the whole-lane
 * FOI verification. This module answers "is the entry's own record honest?" -
 * which is also what makes scaffolded, half-authored entries unmergeable
 * (TODO placeholders fail the shape checks loudly).
 */

import * as fs from 'fs';
import * as path from 'path';
import { calculateFileHash, errorMessage } from '../shared/utils.ts';
import {
  defaultFoiDir,
  listFoiEntryKeys,
  type FoiEntryMeta,
  type FoiFileDeclaration,
  FOI_FILE_ROLES,
  FOI_OUTCOMES,
  FOI_DATASET_CLASSES,
  FOI_DATASET_RECOVERY,
  FOI_RELATION_TYPES,
} from '../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS } from '../shared/foi-normalise.ts';
import {
  heldHashSet,
  normaliseWitnessHash,
  divergenceRecordProblems,
  unpairedDivergentWitnessProblems,
} from '../shared/witness-agreement.ts';
import type { ValidationProblem } from './validate-data.ts';

const SHA256_RE = /^[0-9a-f]{64}$/;
// relatedEntries values that look like entry keys must name real siblings;
// free-text references (drop-zone pointers etc.) contain spaces or slashes
// and are provenance prose, not links.
const ENTRY_KEY_SHAPED_RE = /^(wdtk|ofcom)-[^\s/]+$/;

export interface FoiValidationResult {
  problems: ValidationProblem[];
  checkedEntries: number;
}

// A date field is honest when it parses, or when it is null and the
// matching note field explains the bound (undated published letters:
// ofcom-285990, ofcom-299351). Scaffolded "TODO" strings satisfy neither.
function checkDateField(problems: ValidationProblem[], metaPath: string, field: string, value: unknown, note: unknown): void {
  if (value === null) {
    if (typeof note !== 'string' || note.length === 0) {
      problems.push({ path: metaPath, problem: `${field} is null without a ${field}Note explaining the bound` });
    }
    return;
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    problems.push({ path: metaPath, problem: `${field} is not a parseable date: ${JSON.stringify(value)}` });
  }
}

export function validateFoiEntry(foiDir: string, key: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const dir = path.join(foiDir, key);
  const metaPath = path.join(dir, 'meta.json');

  if (!fs.existsSync(metaPath)) {
    return [{ path: metaPath, problem: 'meta.json is missing' }];
  }
  let meta: FoiEntryMeta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as FoiEntryMeta;
  } catch (err) {
    return [{ path: metaPath, problem: `meta.json is not valid JSON: ${errorMessage(err)}` }];
  }

  // 1-2: schema version; sourceKey matches the lane AND the key prefix.
  if (meta.schemaVersion !== 1) problems.push({ path: metaPath, problem: `unsupported schemaVersion: ${String(meta.schemaVersion)}` });
  const expectedSourceKey = key.startsWith('wdtk-') ? 'wdtk-foi' : key.startsWith('ofcom-') ? 'ofcom-foi' : undefined;
  if (expectedSourceKey === undefined) {
    problems.push({ path: dir, problem: `entry key "${key}" has neither a wdtk- nor an ofcom- prefix` });
  } else if (meta.sourceKey !== expectedSourceKey) {
    problems.push({ path: metaPath, problem: `sourceKey "${String(meta.sourceKey)}" disagrees with the entry-key prefix (expected ${expectedSourceKey})` });
  }

  // 3: requestId agrees with the key for wdtk entries; null for ofcom.
  if (key.startsWith('wdtk-')) {
    const keyId = Number(/^wdtk-(\d+)--/.exec(key)?.[1]);
    if (meta.requestId !== keyId || Number.isNaN(keyId)) {
      problems.push({ path: metaPath, problem: `requestId ${String(meta.requestId)} does not match the wdtk-{id}-- key segment` });
    }
  } else if (meta.requestId !== null) {
    problems.push({ path: metaPath, problem: `requestId must be null for ofcom-foi entries, got ${String(meta.requestId)}` });
  }

  // 4: title and the two request-lifecycle dates.
  if (typeof meta.title !== 'string' || meta.title.length === 0) problems.push({ path: metaPath, problem: 'title is missing or empty' });
  // The title is surfaced as plain (escaped) text in the page <title>, <h1>,
  // breadcrumbs and link text, so any markdown in it renders as literal
  // punctuation rather than formatting. Forbid the syntaxes that are never
  // legitimate in a title - a backtick code-span or an inline [label](url)
  // link - so such a token cannot leak visibly onto a generated page.
  if (typeof meta.title === 'string' && /`|\[[^\]]*\]\([^)]*\)/.test(meta.title)) {
    problems.push({ path: metaPath, problem: `title contains markdown syntax (backtick or inline link) that renders literally in the plain-text page title/heading: ${JSON.stringify(meta.title)}` });
  }
  checkDateField(problems, metaPath, 'requestedAt', meta.requestedAt, meta.requestedAtNote);
  checkDateField(problems, metaPath, 'respondedAt', meta.respondedAt, meta.respondedAtNote);

  // 5: outcome vocabulary.
  if (!FOI_OUTCOMES.includes(meta.outcome)) {
    problems.push({ path: metaPath, problem: `outcome "${String(meta.outcome)}" is not in the vocabulary (${FOI_OUTCOMES.join(', ')})` });
  }

  // 6: dataset-class vocabulary, top-level and per-file.
  if (!Array.isArray(meta.datasetClasses) || meta.datasetClasses.length === 0) {
    problems.push({ path: metaPath, problem: 'datasetClasses is missing or empty' });
  } else {
    for (const cls of meta.datasetClasses) {
      if (FOI_DATASET_CLASSES[cls] === undefined) problems.push({ path: metaPath, problem: `unknown dataset class "${cls}"` });
    }
  }

  const files: Record<string, FoiFileDeclaration> = (typeof meta.files === 'object' && meta.files !== null) ? meta.files : {};
  if (Object.keys(files).length === 0) {
    problems.push({ path: metaPath, problem: 'files map is missing or empty' });
    return problems;
  }
  const declaredNames = new Set(Object.keys(files));
  const hasDataFiles = Object.values(files).some(f => f.role === 'data' || f.role === 'data-container');

  // 7-8: dataVintage vs data files, with datasetRecovery carrying the
  // attested-but-unrecovered case (an authored archive-side state, distinct
  // from the FOI-transaction outcome). The rules are jointly derivable:
  //  - data files present -> dataVintage required; 'unrecovered' contradicts
  //    having the bytes.
  //  - no data files + attested vintage -> datasetRecovery required (the
  //    dataset existed at that vintage; the record must say we lack it).
  //  - no data files + no vintage -> nothing attested (not-held, referral);
  //    datasetRecovery must be absent.
  if (meta.datasetRecovery !== undefined && !FOI_DATASET_RECOVERY.includes(meta.datasetRecovery)) {
    problems.push({ path: metaPath, problem: `datasetRecovery "${meta.datasetRecovery}" is not in the vocabulary (${FOI_DATASET_RECOVERY.join(', ')})` });
  }
  if (hasDataFiles) {
    if (meta.dataVintage === null || meta.dataVintage === undefined) {
      problems.push({ path: metaPath, problem: 'dataVintage is null but the entry declares data files' });
    }
    if (meta.datasetRecovery === 'unrecovered') {
      problems.push({ path: metaPath, problem: 'datasetRecovery "unrecovered" contradicts the declared data files' });
    }
  } else if (meta.dataVintage !== null && meta.dataVintage !== undefined) {
    if (meta.datasetRecovery === undefined) {
      problems.push({ path: metaPath, problem: 'dataVintage is attested but no data files exist - declare datasetRecovery (unrecovered/partial)' });
    }
  } else if (meta.datasetRecovery !== undefined) {
    problems.push({ path: metaPath, problem: 'datasetRecovery declared but nothing is attested (no data files, null dataVintage)' });
  }

  // 9: converter binding referential integrity.
  if (meta.converter !== null && meta.converter !== undefined) {
    if (meta.converter.script !== 'src/shared/foi-normalise.ts') {
      problems.push({ path: metaPath, problem: `converter.script must be src/shared/foi-normalise.ts, got ${String(meta.converter.script)}` });
    }
    const variant = meta.converter.variant;
    const conversions = typeof variant === 'string' ? FOI_ENTRY_CONVERSIONS[variant] : undefined;
    if (conversions === undefined) {
      problems.push({ path: metaPath, problem: `converter.variant "${String(variant)}" is not in the conversion registry` });
    } else {
      for (const conversion of conversions) {
        if (!declaredNames.has(conversion.sourceFile)) {
          problems.push({ path: metaPath, problem: `converter variant "${String(variant)}" reads "${conversion.sourceFile}" which is not declared in files` });
        }
      }
    }
  }

  // 10: relatedEntries - key-shaped values must name real siblings; a typed
  // relationType (#580) additionally requires the target to be a real sibling
  // (never a free-text drop-zone note) and to reciprocate the same type -
  // 'same-dataset' asserts an identity that is symmetric by definition.
  for (const related of meta.relatedEntries ?? []) {
    if (typeof related.entry !== 'string' || related.entry.length === 0 || typeof related.relation !== 'string' || related.relation.length === 0) {
      problems.push({ path: metaPath, problem: 'relatedEntries items need non-empty entry and relation' });
      continue;
    }
    const keyShaped = ENTRY_KEY_SHAPED_RE.test(related.entry);
    if (keyShaped && !fs.existsSync(path.join(foiDir, related.entry))) {
      problems.push({ path: metaPath, problem: `relatedEntries names "${related.entry}" but no such sibling entry exists` });
      continue;
    }
    if (related.relationType === undefined) continue;
    if (!FOI_RELATION_TYPES.includes(related.relationType)) {
      problems.push({ path: metaPath, problem: `relatedEntries relationType "${related.relationType}" is not in the vocabulary (${FOI_RELATION_TYPES.join(', ')})` });
      continue;
    }
    if (!keyShaped) {
      problems.push({ path: metaPath, problem: `relatedEntries relationType "${related.relationType}" requires a real sibling entry, not the free-text reference "${related.entry}"` });
      continue;
    }
    const siblingMetaPath = path.join(foiDir, related.entry, 'meta.json');
    let siblingMeta: FoiEntryMeta | undefined;
    try {
      siblingMeta = JSON.parse(fs.readFileSync(siblingMetaPath, 'utf8')) as FoiEntryMeta;
    } catch {
      // A missing or malformed sibling meta.json is reported when that
      // sibling entry is itself validated - not duplicated here.
      continue;
    }
    // A malformed relatedEntries on the SIBLING (not an array) must be
    // reported, not thrown through - a validator has to locate the
    // malformation, not crash the whole run on it.
    if (siblingMeta.relatedEntries !== undefined && !Array.isArray(siblingMeta.relatedEntries)) {
      problems.push({ path: metaPath, problem: `relatedEntries declares "${related.entry}" as relationType "${related.relationType}", but "${related.entry}"'s own relatedEntries is malformed (not an array) - reciprocation cannot be checked` });
      continue;
    }
    const reciprocated = (siblingMeta.relatedEntries ?? []).some(r => r.entry === key && r.relationType === related.relationType);
    if (!reciprocated) {
      problems.push({ path: metaPath, problem: `relatedEntries declares "${related.entry}" as relationType "${related.relationType}", but "${related.entry}" does not declare "${key}" back with the same relationType - ${related.relationType} must be symmetric` });
    }
  }

  // 11: the ADR 0004 invariant - meta + correspondence always.
  if (files['correspondence.md']?.role !== 'transcript') {
    problems.push({ path: metaPath, problem: 'files must declare correspondence.md with role transcript' });
  }

  // 12: per-declaration shape and derivation references.
  for (const [name, declared] of Object.entries(files)) {
    const label = `files["${name}"]`;
    if (!Number.isInteger(declared.bytes) || declared.bytes < 0) problems.push({ path: metaPath, problem: `${label}: bytes must be a non-negative integer` });
    if (typeof declared.sha256 !== 'string' || !SHA256_RE.test(declared.sha256)) problems.push({ path: metaPath, problem: `${label}: sha256 must be 64 lowercase hex characters` });
    // recordCount is the mechanically-known row count (present only where a
    // converter produced this file - #683); the exact re-derivation this
    // implies is cross-checked against convertFoiEntry's own count by the
    // whole-lane verification (foi-verification.ts), not here.
    if (declared.recordCount !== undefined && (!Number.isInteger(declared.recordCount) || declared.recordCount < 0)) {
      problems.push({ path: metaPath, problem: `${label}: recordCount must be a non-negative integer when present` });
    }
    if (!FOI_FILE_ROLES.includes(declared.role)) problems.push({ path: metaPath, problem: `${label}: unknown role "${String(declared.role)}"` });
    for (const cls of declared.datasetClasses ?? []) {
      if (FOI_DATASET_CLASSES[cls] === undefined) problems.push({ path: metaPath, problem: `${label}: unknown dataset class "${cls}"` });
    }
    for (const refField of ['extractOf', 'extractedFrom', 'normalisedFrom', 'divergesFrom'] as const) {
      const ref = declared[refField];
      if (ref !== undefined && !declaredNames.has(ref)) {
        problems.push({ path: metaPath, problem: `${label}: ${refField} references "${ref}" which is not declared` });
      }
    }
    for (const witness of declared.witnesses ?? []) {
      if (typeof witness.channel !== 'string' || witness.channel.length === 0 || typeof witness.url !== 'string' || witness.url.length === 0) {
        problems.push({ path: metaPath, problem: `${label}: witness entries need non-empty channel and url` });
      }
      // The optional witness hash, when present, must be a well-formed sha256:
      // agreement is derived from it (#618 increment 3).
      if (witness.sha256 !== undefined && !SHA256_RE.test(witness.sha256)) {
        problems.push({ path: metaPath, problem: `${label}: witness sha256 must be 64 lowercase hex characters when present, got ${JSON.stringify(witness.sha256)}` });
      }
    }
  }

  // Derived witness agreement (#618 increment 3 / #619): a witness whose bytes
  // match no held copy is DIVERGENT and must be paired with a divergence record.
  // FOI witnesses are per file; agreement is compared against the union of the
  // entry's held file hashes, so a copy the mirror holds anywhere corroborates.
  const heldHashes = heldHashSet(Object.values(files).map(f => f.sha256));
  problems.push(...divergenceRecordProblems(meta.divergences, declaredNames).map(problem => ({ path: metaPath, problem })));
  const witnessContexts = Object.entries(files).flatMap(([name, decl]) =>
    (decl.witnesses ?? []).map((w, i) => ({ label: `files["${name}"].witnesses[${i}]`, sha256: normaliseWitnessHash(w.sha256), heldHashes })));
  problems.push(...unpairedDivergentWitnessProblems(witnessContexts, meta.divergences ?? []).map(problem => ({ path: metaPath, problem })));

  // 13: byte integrity - the ADR 0004 point-4 commitment. Same shape as the
  // open-data validator: exists, size-match (skip hash on mismatch - report
  // the root cause only), sha256, and no undeclared files riding along.
  for (const [name, declared] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      problems.push({ path: filePath, problem: `declared in meta.json (${name}) but absent from disk` });
      continue;
    }
    const actualSize = fs.statSync(filePath).size;
    if (actualSize !== declared.bytes) {
      problems.push({ path: filePath, problem: `size mismatch: meta declares ${declared.bytes} bytes, disk has ${actualSize}` });
      continue;
    }
    const actualHash = calculateFileHash(filePath);
    if (actualHash !== declared.sha256) {
      problems.push({ path: filePath, problem: `sha256 mismatch: meta declares ${declared.sha256}, disk has ${actualHash}` });
    }
  }
  for (const name of fs.readdirSync(dir)) {
    if (name === 'meta.json') continue;
    if (!declaredNames.has(name)) {
      problems.push({ path: path.join(dir, name), problem: `file ${name} present on disk but not declared in meta.json` });
    }
  }

  return problems;
}

export function validateFoiLaneAt(foiDir: string = defaultFoiDir()): FoiValidationResult {
  // A missing lane directory is a valid state (scratch fixtures, pre-FOI
  // checkouts); a present-but-empty one is not.
  if (!fs.existsSync(foiDir)) return { problems: [], checkedEntries: 0 };
  const keys = listFoiEntryKeys(foiDir);
  if (keys.length === 0) return { problems: [{ path: foiDir, problem: 'archive/foi exists but contains no entries' }], checkedEntries: 0 };
  const problems: ValidationProblem[] = [];
  for (const key of keys) {
    problems.push(...validateFoiEntry(foiDir, key));
  }
  return { problems, checkedEntries: keys.length };
}
