/**
 * The publisher register (issue #618, increment 1) — the ONE hand-curated,
 * code-reviewed vocabulary of the bodies that originate, archive, aggregate or
 * host the material this project mirrors.
 *
 * It is the single source of truth every witness `channel` token resolves
 * through: the open-data lane's entry-level witnesses (`ArchiveMeta.witnesses`,
 * src/shared/utils.ts) and the FOI lane's per-file witnesses (`FoiWitness`,
 * src/shared/foi-archive.ts) both carry a free-text `channel`, and this register
 * turns that free text into a known publisher — so an unknown future channel
 * fails validation loudly rather than rendering as a raw token (issue #620).
 *
 * The register lives at reference-data/publishers.json. It is project-authored
 * metadata ABOUT sources, not distilled source data, which is why it sits in
 * reference-data despite that directory's Ofcom/ITU-only provenance policy (see
 * reference-data/README.md's carve-out).
 *
 * Later increments slot into this shape without changing it: publisher pages
 * (increment 2) render each entry; witness hashes (3) and divergence records
 * (4) compose with the `authorityCeiling` cross-check; collection tooling (5)
 * reads `fetchConstraints`. Nothing here persists a trust rung — the ceiling is
 * a register fact against which a lane-derived rung is cross-checked, never a
 * second dial (ADR 0014).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceAuthority } from './source-authority.ts';
import { AUTHORITY_ORDER } from './source-authority.ts';

// The register file, resolved from the repo root (this module lives at
// src/shared/, two levels down).
export const PUBLISHER_REGISTER_PATH = path.resolve(import.meta.dirname, '..', '..', 'reference-data', 'publishers.json');

// The functional role(s) a publisher plays. A publisher may hold several.
//  - originator           originates the material (Ofcom for the register; ITU
//                          for the international call-sign-series table)
//  - official-archive      an official/government archive institution that
//                          captures and serves others' publications (UKGWA)
//  - web-archive           a general web-archiving service (the Internet
//                          Archive) — an archive, but not an official one, so
//                          the officialness is carried by authorityCeiling
//  - foi-aggregator        publishes and archives FOI correspondence
//                          (WhatDoTheyKnow)
//  - community-documentation  community-authored reference material (OARC wiki,
//                          Wikipedia, the RSGB's operating guidance)
//  - incidental-host       hosts material without curating it (GitHub)
export const PUBLISHER_ROLES: readonly string[] = [
  'originator',
  'official-archive',
  'web-archive',
  'foi-aggregator',
  'community-documentation',
  'incidental-host',
];

// The machine token for why the mirror may hold and republish a publisher's
// material. `unverified` is the deliberate fail-honest value: it asserts that
// the basis has NOT been established, never a flattering guess.
export const LICENCE_BASES: readonly string[] = [
  'ogl-v3',            // Open Government Licence v3 (UK Crown copyright material)
  'ofcom-terms',       // Ofcom's own website terms of use (free accurate reproduction with acknowledgement)
  'crown-copyright',   // Crown copyright, no more specific re-use licence cited
  'copyright-cite-only', // third-party copyright; cited, not redistributed in bulk
  'site-terms',        // the host's own terms of service
  'unverified',        // basis not established — fail-honest, never asserted
];

// The authority ceiling reuses ADR 0014's source-authority rungs verbatim
// (site/glossary.html #axes) — the register does not invent a parallel ladder.
export type AuthorityCeiling = SourceAuthority;
export const AUTHORITY_CEILINGS: readonly AuthorityCeiling[] = AUTHORITY_ORDER;

export interface PublisherEntry {
  id: string;
  name: string;
  roles: string[];
  // Optional parent body (a field, not a second entity): "The National
  // Archives" operates UKGWA.
  operator?: string;
  url: string;
  // The witness `channel` tokens that resolve to this publisher. Each token
  // belongs to exactly one publisher (the validator enforces uniqueness), so
  // the register is the channel vocabulary. Empty for citation-only publishers
  // that no witness is recorded through.
  channels: string[];
  // The publisher's DEFAULT/TYPICAL licence basis, not a blanket claim over its
  // whole catalogue: licensing is publication-specific — a publisher's current
  // publications may carry one licence while historical ones carry another. Each
  // dataset/publication can override this default with its own basis (the
  // per-publication licence fields arrive in a later increment); until then this
  // is the fallback a holding inherits when it declares nothing of its own.
  licenceBasis: string;
  // Plain-English statement of why the mirror may, by default, hold and
  // republish this publisher's material, with the governing terms linked from
  // licenceUrl. It describes the publisher's typical/current terms; a specific
  // publication may differ (notably historical vintages), and a per-publication
  // basis overrides this when present.
  licenceStatement: string;
  // The governing terms document. Optional only for publishers whose basis is
  // `unverified` (there is, by definition, no settled terms document to cite).
  licenceUrl?: string;
  // The highest ADR 0014 rung material witnessed ONLY via this publisher may
  // carry. A cross-check ceiling, not a persisted rung (composed in later
  // increments; never inflates a lane-derived rung).
  authorityCeiling: AuthorityCeiling;
  // Operational fetch posture (robots, IP constraints, targeted-URL-only) for
  // the collection tooling of increment 5. Optional for citation-only entries.
  fetchConstraints?: string;
  notes?: string;
}

export interface PublisherRegister {
  schemaVersion: number;
  publishers: PublisherEntry[];
}

export function readPublisherRegister(registerPath: string = PUBLISHER_REGISTER_PATH): PublisherRegister {
  return JSON.parse(fs.readFileSync(registerPath, 'utf8')) as PublisherRegister;
}

// A channel -> publisher index built once from a register, so repeated witness
// resolution is a map lookup rather than a scan. Only well-formed registers
// (unique channel tokens) build a sound index; the validator is what guarantees
// that, so consumers should validate before trusting the index.
export function channelIndex(register: PublisherRegister): Map<string, PublisherEntry> {
  const index = new Map<string, PublisherEntry>();
  for (const publisher of register.publishers) {
    for (const channel of publisher.channels) {
      // Last-writer-wins on a duplicate; the validator rejects duplicates, so a
      // sound register never reaches that case.
      index.set(channel, publisher);
    }
  }
  return index;
}

// Resolve a witness channel token to its publisher, or undefined when the token
// is unknown to the register (which the validator turns into a hard failure).
export function publisherForChannel(index: Map<string, PublisherEntry>, channel: string): PublisherEntry | undefined {
  return index.get(channel);
}

// The display name a channel token renders as on a page: the publisher's name
// when the token resolves, else the raw token (so a page never silently drops a
// witness — the validator is the loud line of defence; this keeps rendering
// total).
export function channelDisplayName(index: Map<string, PublisherEntry>, channel: string): string {
  return index.get(channel)?.name ?? channel;
}

// An id -> publisher index, so a holding's author id (or a channel's resolved
// publisher id) can be looked up once rather than scanned per reference. Ids are
// unique (the validator enforces it), so a sound register builds a sound index.
export function publisherIndexById(register: PublisherRegister): Map<string, PublisherEntry> {
  return new Map(register.publishers.map(p => [p.id, p]));
}

// The AUTHOR (originator) of an archive entry, derived purely from its
// sourceKey (issue #618). Author, publication channel and host are separate
// axes: the sourceKey names the dataset series and its FOI serving channel, from
// which the ORIGINATING publisher is derived — never the serving channel, which
// witnesses carry instead. Every dataset the mirror currently holds originates
// from Ofcom: the open-data register (`ofcom-amateur-callsigns`) and the FOI
// disclosures Ofcom answered, whether served via its own disclosure log
// (`ofcom-foi`) or a WhatDoTheyKnow thread (`wdtk-*`). An unmapped sourceKey
// resolves to undefined so the caller FLAGS it rather than defaulting to a
// flattering author (ADR 0014's flag-never-guess discipline); an explicit
// per-entry author field is introduced when the first non-Ofcom-originated
// dataset lands.
export function authorPublisherId(sourceKey: string): string | undefined {
  if (sourceKey === 'ofcom-amateur-callsigns') return 'ofcom';
  if (sourceKey === 'ofcom-foi') return 'ofcom';
  if (sourceKey.startsWith('wdtk')) return 'ofcom';
  return undefined;
}
