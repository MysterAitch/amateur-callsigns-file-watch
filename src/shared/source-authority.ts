/**
 * The canonical trust model, axis 2 (source authority) — the ONE place a
 * dataset's authority rung is derived from its provenance, so no surface can
 * quietly assert a higher rung than its lane warrants (issue #155, #398).
 *
 * Authority is DERIVED ON READ from the lane a source lives in, never persisted
 * per meta: the lane is already an immutable fact (open-data publications live
 * under archive/<date>/, FOI disclosures under archive/foi/**, reference tables
 * under reference-data/), so a persisted authority field would be a second copy
 * that can drift from the lane it is supposed to describe. Deriving keeps the
 * lane the single source of truth. The one guard we DO apply is a sourceKey
 * cross-check: a source sitting in the open-data lane but declaring a non-Ofcom
 * sourceKey is FLAGGED, never silently rated Official — trust must only degrade
 * through derivation, never inflate.
 *
 * The rungs and their meaning are fixed by site/glossary.html (the #axes panel);
 * this module is the machine-readable copy of that ladder, not a redefinition.
 */

// The five source-authority rungs, best-to-worst known origin. These describe
// ORIGIN, not strictly better-or-worse quality (see the glossary), but the
// order is load-bearing for the no-inflation invariant: a derived claim can
// never resolve to a higher (earlier) rung than the source it derives from.
export type SourceAuthority = 'Official' | 'FOI' | 'Reference' | 'Community' | 'Self';

export const AUTHORITY_ORDER: readonly SourceAuthority[] = [
  'Official',
  'FOI',
  'Reference',
  'Community',
  'Self',
];

// The lanes a source can live in. A lane is a mechanical fact about WHERE the
// bytes are held; authority is a pure function of it.
export type SourceLane = 'open-data' | 'foi' | 'reference-data' | 'project-derived' | 'community';

// The ONE lane -> authority mapping. Every other surface that shows a trust
// rating must agree with this table or the consistency check fails.
const LANE_AUTHORITY: Readonly<Record<SourceLane, SourceAuthority>> = {
  'open-data': 'Official',
  'foi': 'FOI',
  'reference-data': 'Reference',
  'community': 'Community',
  'project-derived': 'Self',
};

// The sourceKey the open-data lane must declare. A date-keyed archive entry
// carrying any other sourceKey is NOT silently rated Official — it is flagged
// (deriveSourceAuthority returns ok:false), because the open-data lane is the
// top authority rung and mis-attributing a foreign source into it is exactly
// the inflation this net exists to catch. Mirrors OFCOM_AMATEUR_SOURCE_KEY
// (kept as a literal here so the shared module carries no CI/const coupling).
const OPEN_DATA_SOURCE_KEY = 'ofcom-amateur-callsigns';

// A supplied sourceKey belongs to the FOI lane iff it names an FOI channel:
// Ofcom's own disclosure log ('ofcom-foi') or a WhatDoTheyKnow thread
// ('wdtk-*'). Both resolve to the FOI rung; the distinction is recorded
// elsewhere (build-data-status) but does not change authority.
function isFoiSourceKey(sourceKey: string): boolean {
  return sourceKey === 'ofcom-foi' || sourceKey.startsWith('wdtk');
}

// Everything needed to resolve authority: a location string that discloses the
// lane, plus the declared sourceKey where one exists. `location` accepts either
// an archive-relative location (an entry's directory: 'foi/<entry>', a bare
// date key '2025-06-04', 'reference-data/<file>') OR a ledger claim's
// sourceFile ('foi/<entry>/raw.csv', 'opendata/<date>/raw.csv') — both name the
// lane in their leading segment, so one classifier serves the archive metas and
// the claim ledger alike.
export interface SourceProvenance {
  location: string;
  sourceKey?: string;
}

// The result of a derivation. Ambiguity is FLAGGED (ok:false), never resolved
// to a guessed rung — an unclassifiable or inflation-suspect provenance must
// fail loud, not default to a flattering default.
export type AuthorityResolution =
  | { ok: true; lane: SourceLane; authority: SourceAuthority }
  | { ok: false; reason: string };

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}(--[0-9a-f]+)?$/;

// Classify a location string to its lane, mechanically. Returns null when the
// location matches no known lane (the caller turns that into a flag).
function laneForLocation(location: string): SourceLane | null {
  const trimmed = location.trim();
  if (trimmed === '') return null;
  const head = trimmed.split('/')[0];

  if (head === 'foi') return 'foi';
  if (head === 'opendata') return 'open-data';
  if (head === 'reference-data') return 'reference-data';
  if (head === 'project-derived') return 'project-derived';
  if (head === 'community') return 'community';
  // A bare date key (an open-data archive entry's directory name).
  if (DATE_KEY_RE.test(head)) return 'open-data';
  return null;
}

// The canonical derivation: provenance -> authority rung, or a flag. This is the
// single source of truth every trust surface and every check must go through.
export function deriveSourceAuthority(provenance: SourceProvenance): AuthorityResolution {
  const lane = laneForLocation(provenance.location);
  if (lane === null) {
    return { ok: false, reason: `location "${provenance.location}" matches no known lane` };
  }

  const { sourceKey } = provenance;
  if (sourceKey !== undefined) {
    // Cross-check the declared sourceKey against the lane. A mismatch is an
    // inflation risk (a foreign source claiming a lane's rung) and is flagged
    // rather than resolved upward.
    if (lane === 'open-data' && sourceKey !== OPEN_DATA_SOURCE_KEY) {
      return {
        ok: false,
        reason: `open-data lane entry declares foreign sourceKey "${sourceKey}" (expected "${OPEN_DATA_SOURCE_KEY}") — would inflate to Official`,
      };
    }
    if (lane === 'foi' && !isFoiSourceKey(sourceKey)) {
      return {
        ok: false,
        reason: `FOI lane entry declares unrecognised sourceKey "${sourceKey}"`,
      };
    }
  }

  return { ok: true, lane, authority: LANE_AUTHORITY[lane] };
}

// The rank of an authority rung (0 = highest authority). Lets callers compare
// rungs to assert derivation never moves UP the ladder.
export function authorityRank(authority: SourceAuthority): number {
  return AUTHORITY_ORDER.indexOf(authority);
}
