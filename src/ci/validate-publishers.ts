/**
 * Publisher-register validation (issue #618, increment 1), run inside
 * `validate:data` alongside the open-data and FOI lane validators.
 *
 * The register (reference-data/publishers.json) is the vocabulary every witness
 * `channel` token must resolve through. This validator enforces:
 *  - schema shape and closed vocabularies (roles, licence bases, ADR 0014
 *    authority-ceiling rungs);
 *  - unique publisher ids and unique channel tokens (each token belongs to
 *    exactly one publisher, so resolution is unambiguous);
 *  - well-formed URLs, and a cited governing-terms URL for every publisher
 *    whose licence basis is not the fail-honest `unverified`;
 *  - referential closure: every witness `channel` recorded across BOTH archive
 *    lanes resolves to a register entry — this is what turns an unknown future
 *    channel into a loud failure (issue #620) rather than a raw token on a page.
 *
 * Purely structural/referential, matching validate-foi's design: it answers "is
 * the register itself honest, and does every witness resolve through it?".
 */

import * as fs from 'fs';
import * as path from 'path';
import { errorMessage } from '../shared/utils.ts';
import { defaultFoiDir, type FoiEntryMeta } from '../shared/foi-archive.ts';
import {
  PUBLISHER_REGISTER_PATH,
  PUBLISHER_ROLES,
  LICENCE_BASES,
  AUTHORITY_CEILINGS,
  type PublisherRegister,
} from '../shared/publishers.ts';
import { isPlainObject, describeShape, type ValidationProblem } from './validate-data.ts';

// The open-data lane's archive root (cwd-relative, matching validate-data).
const DEFAULT_ARCHIVE_DIR = 'archive';
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}(--[0-9a-f]+)?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isWellFormedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Shape, vocabulary and uniqueness of the register itself — pure over the parsed
// register, so tests exercise it with in-memory fixtures. registerPath only
// labels the reported problems.
export function validatePublisherRegister(register: PublisherRegister, registerPath: string = PUBLISHER_REGISTER_PATH): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  // The register's declared type is aspirational, not verified: a caller
  // reading the file straight off disk has only JSON.parse's `unknown`, and a
  // malformed top-level value (null, an array, a scalar) must be REPORTED
  // here rather than crash the first field read below (#812).
  if (!isPlainObject(register)) {
    problems.push({ path: registerPath, problem: `publisher register must be a JSON object, got ${describeShape(register)}` });
    return problems;
  }

  if (register.schemaVersion !== 1) {
    problems.push({ path: registerPath, problem: `unsupported schemaVersion: ${String(register.schemaVersion)}` });
  }
  if (!Array.isArray(register.publishers) || register.publishers.length === 0) {
    problems.push({ path: registerPath, problem: 'publishers is missing or empty' });
    return problems;
  }

  const seenIds = new Set<string>();
  const channelOwners = new Map<string, string>();

  for (const [i, publisher] of register.publishers.entries()) {
    if (!isPlainObject(publisher)) {
      problems.push({ path: registerPath, problem: `publishers[${i}] must be an object, got ${describeShape(publisher)}` });
      continue;
    }
    const at = `publishers[${i}]${isNonEmptyString(publisher.id) ? ` (${publisher.id})` : ''}`;

    if (!isNonEmptyString(publisher.id)) {
      problems.push({ path: registerPath, problem: `${at}.id is missing or empty` });
    } else if (seenIds.has(publisher.id)) {
      problems.push({ path: registerPath, problem: `${at}.id is a duplicate` });
    } else {
      seenIds.add(publisher.id);
    }

    if (!isNonEmptyString(publisher.name)) {
      problems.push({ path: registerPath, problem: `${at}.name is missing or empty` });
    }

    if (!Array.isArray(publisher.roles) || publisher.roles.length === 0) {
      problems.push({ path: registerPath, problem: `${at}.roles is missing or empty` });
    } else {
      for (const role of publisher.roles) {
        if (!PUBLISHER_ROLES.includes(role)) {
          problems.push({ path: registerPath, problem: `${at}.roles contains unknown role "${String(role)}" (valid: ${PUBLISHER_ROLES.join(', ')})` });
        }
      }
    }

    if (publisher.operator !== undefined && !isNonEmptyString(publisher.operator)) {
      problems.push({ path: registerPath, problem: `${at}.operator is present but empty` });
    }

    if (!isNonEmptyString(publisher.url)) {
      problems.push({ path: registerPath, problem: `${at}.url is missing or empty` });
    } else if (!isWellFormedUrl(publisher.url)) {
      problems.push({ path: registerPath, problem: `${at}.url is not a well-formed http(s) URL: ${publisher.url}` });
    }

    if (!Array.isArray(publisher.channels)) {
      problems.push({ path: registerPath, problem: `${at}.channels must be an array` });
    } else {
      for (const channel of publisher.channels) {
        if (!isNonEmptyString(channel)) {
          problems.push({ path: registerPath, problem: `${at}.channels contains an empty token` });
          continue;
        }
        const owner = channelOwners.get(channel);
        if (owner !== undefined) {
          problems.push({ path: registerPath, problem: `channel token "${channel}" is claimed by more than one publisher (${owner} and ${String(publisher.id)}) — each token must belong to exactly one` });
        } else {
          channelOwners.set(channel, String(publisher.id));
        }
      }
    }

    if (!LICENCE_BASES.includes(publisher.licenceBasis)) {
      problems.push({ path: registerPath, problem: `${at}.licenceBasis "${String(publisher.licenceBasis)}" is not in the vocabulary (${LICENCE_BASES.join(', ')})` });
    }

    if (!isNonEmptyString(publisher.licenceStatement)) {
      problems.push({ path: registerPath, problem: `${at}.licenceStatement is missing or empty` });
    }

    // A licence claim is a public statement: every basis other than the
    // fail-honest `unverified` must cite its governing terms.
    if (publisher.licenceUrl !== undefined) {
      if (!isNonEmptyString(publisher.licenceUrl) || !isWellFormedUrl(publisher.licenceUrl)) {
        problems.push({ path: registerPath, problem: `${at}.licenceUrl is not a well-formed http(s) URL: ${String(publisher.licenceUrl)}` });
      }
    } else if (publisher.licenceBasis !== 'unverified') {
      problems.push({ path: registerPath, problem: `${at}.licenceUrl is required unless licenceBasis is "unverified" (basis "${String(publisher.licenceBasis)}" must cite its governing terms)` });
    }

    // Licence citations (#618): the pages a human would visit to reach the same
    // conclusion. Each must be a well-formed URL with a non-empty note; any basis
    // other than the fail-honest `unverified` must carry at least one — no
    // licence claim rests on evidence the public cannot check.
    if (!Array.isArray(publisher.licenceCitations)) {
      problems.push({ path: registerPath, problem: `${at}.licenceCitations must be an array` });
    } else {
      for (const [j, citation] of publisher.licenceCitations.entries()) {
        const cAt = `${at}.licenceCitations[${j}]`;
        if (typeof citation !== 'object' || citation === null) {
          problems.push({ path: registerPath, problem: `${cAt} must be an object with url and note` });
          continue;
        }
        if (!isNonEmptyString(citation.url) || !isWellFormedUrl(citation.url)) {
          problems.push({ path: registerPath, problem: `${cAt}.url is not a well-formed http(s) URL: ${String(citation.url)}` });
        }
        if (!isNonEmptyString(citation.note)) {
          problems.push({ path: registerPath, problem: `${cAt}.note is missing or empty (a citation must say what the page establishes)` });
        }
      }
      if (publisher.licenceBasis !== 'unverified' && publisher.licenceCitations.length === 0) {
        problems.push({ path: registerPath, problem: `${at}.licenceCitations must name at least one verifiable source unless licenceBasis is "unverified" (basis "${String(publisher.licenceBasis)}" must be checkable by the public)` });
      }
    }

    if (!AUTHORITY_CEILINGS.includes(publisher.authorityCeiling)) {
      problems.push({ path: registerPath, problem: `${at}.authorityCeiling "${String(publisher.authorityCeiling)}" is not a valid ADR 0014 rung (${AUTHORITY_CEILINGS.join(', ')})` });
    }
  }

  return problems;
}

// One recorded witness channel, with a location string for error reporting.
interface WitnessChannelRef {
  channel: string;
  at: string;
}

// Enumerate every witness `channel` token recorded across both archive lanes:
// the open-data lane's entry-level ArchiveMeta.witnesses, and the FOI lane's
// per-file FoiWitness entries.
export function collectWitnessChannels(archiveDir: string = DEFAULT_ARCHIVE_DIR, foiDir: string = defaultFoiDir()): WitnessChannelRef[] {
  const refs: WitnessChannelRef[] = [];

  if (fs.existsSync(archiveDir)) {
    for (const name of fs.readdirSync(archiveDir)) {
      if (!DATE_KEY_RE.test(name)) continue;
      const metaPath = path.join(archiveDir, name, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        continue; // The open-data validator reports unreadable metas.
      }
      // A malformed top-level meta (null, an array, a scalar) is reported by
      // the open-data validator too - this is a pure collector, so it just
      // skips rather than crashing on `meta.witnesses` of a non-object.
      if (!isPlainObject(parsed)) continue;
      const meta = parsed as { witnesses?: { channel?: unknown }[] };
      const witnesses = Array.isArray(meta.witnesses) ? meta.witnesses : [];
      for (const [i, witness] of witnesses.entries()) {
        if (isPlainObject(witness) && isNonEmptyString(witness.channel)) refs.push({ channel: witness.channel, at: `${metaPath} witnesses[${i}]` });
      }
    }
  }

  if (fs.existsSync(foiDir)) {
    for (const name of fs.readdirSync(foiDir)) {
      const dir = path.join(foiDir, name);
      const metaPath = path.join(dir, 'meta.json');
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(metaPath)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        continue; // The FOI validator reports unreadable metas.
      }
      if (!isPlainObject(parsed)) continue; // ditto - reported by the FOI validator.
      const meta = parsed as FoiEntryMeta;
      const files = isPlainObject(meta.files) ? meta.files : {};
      for (const [fileName, decl] of Object.entries(files)) {
        if (!isPlainObject(decl)) continue;
        const witnesses = Array.isArray(decl.witnesses) ? decl.witnesses : [];
        for (const [i, witness] of witnesses.entries()) {
          if (isPlainObject(witness) && isNonEmptyString(witness.channel)) refs.push({ channel: witness.channel, at: `${metaPath} files["${fileName}"].witnesses[${i}]` });
        }
      }
    }
  }

  return refs;
}

// Referential closure: every recorded witness channel resolves to a register
// entry. An unknown token fails loud — the register IS the channel vocabulary.
export function validateWitnessChannelsResolve(register: PublisherRegister, channels: WitnessChannelRef[]): ValidationProblem[] {
  const known = new Set<string>();
  // validatePublisherRegister already reports a malformed publishers array (or a
  // malformed item within it) - this runs regardless of that outcome (both are
  // called unconditionally over the same parsed register), so it just skips
  // what it cannot read rather than reporting it a second time or crashing.
  for (const publisher of Array.isArray(register.publishers) ? register.publishers : []) {
    if (!isPlainObject(publisher) || !Array.isArray(publisher.channels)) continue;
    for (const channel of publisher.channels) {
      if (typeof channel === 'string') known.add(channel);
    }
  }
  const problems: ValidationProblem[] = [];
  for (const ref of channels) {
    if (!known.has(ref.channel)) {
      problems.push({ path: ref.at, problem: `witness channel "${ref.channel}" resolves to no publisher in the register — add it to a publisher's channels, or correct the token` });
    }
  }
  return problems;
}

// The full check: register shape + every witness channel across both lanes
// resolving. Directory-parameterised for tests; validate-data calls the default.
export function validatePublishersAt(registerPath: string = PUBLISHER_REGISTER_PATH, archiveDir: string = DEFAULT_ARCHIVE_DIR, foiDir: string = defaultFoiDir()): ValidationProblem[] {
  if (!fs.existsSync(registerPath)) {
    return [{ path: registerPath, problem: 'publisher register is missing' }];
  }
  let register: PublisherRegister;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
    // A malformed top-level register (null, an array, a scalar) must be
    // reported here, before either check below reads a property off it -
    // validatePublisherRegister guards this too (so it can be unit-tested
    // directly with a malformed value), but validateWitnessChannelsResolve
    // has no shape of its own to fall back on if this one crashes first.
    if (!isPlainObject(parsed)) {
      return [{ path: registerPath, problem: `publisher register must be a JSON object, got ${describeShape(parsed)}` }];
    }
    register = parsed as PublisherRegister;
  } catch (err) {
    return [{ path: registerPath, problem: `publisher register is not valid JSON: ${errorMessage(err)}` }];
  }
  const problems = validatePublisherRegister(register, registerPath);
  problems.push(...validateWitnessChannelsResolve(register, collectWitnessChannels(archiveDir, foiDir)));
  return problems;
}
