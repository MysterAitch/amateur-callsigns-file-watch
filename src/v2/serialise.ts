/**
 * Serialisations of the claim ledger.
 *
 * Canonical: JSON Lines (claims.jsonl) — one claim per line, approachable,
 * git-diffable, and natively loadable by DuckDB. This is the committed
 * source-of-truth format.
 *
 * Derived: a thin N-Quads export for linked-data consumers, provably a fold of
 * the JSONL. Each claim becomes a quad in a per-source named graph, with the
 * observation (not the bare subject) as the node — because observation identity
 * (source_file, ordinal), not subject identity, is the ledger's key. No triple
 * store runs in production; this is a downloadable lens only.
 */

import type { Claim, SourcePosition, ViewAnchor } from './claim.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// One JSON object per line, keys in a fixed order for a stable, diffable file.
// Emitting the object by hand (rather than JSON.stringify over an arbitrary
// key order) keeps the serialisation deterministic regardless of insertion
// order, so a re-run diff is a real signal.
export function serialiseClaimsJsonl(claims: readonly Claim[]): string {
  return claims.map(claim => {
    const ordered: Record<string, unknown> = {
      layer: claim.layer,
      rawSubject: claim.rawSubject,
      predicate: claim.predicate,
      object: claim.object,
      sourceFile: claim.provenance.sourceFile,
      ordinal: claim.provenance.ordinal,
      vintage: claim.provenance.vintage,
    };
    if (claim.rule !== undefined) ordered.rule = claim.rule;
    // The source-position enrichment (issue #431), emitted only when the loader
    // attested it - additive exactly like `rule`, so legacy ledgers round-trip
    // unchanged. position is the source-intrinsic coordinate; viewAnchor is the
    // line-viewable repo target a deep-link points at (§4.5).
    if (claim.provenance.position !== undefined) ordered.position = claim.provenance.position;
    if (claim.provenance.viewAnchor !== undefined) ordered.viewAnchor = claim.provenance.viewAnchor;
    return JSON.stringify(ordered);
  }).join('\n') + (claims.length > 0 ? '\n' : '');
}

// Parse a JSONL ledger back to claims — the round-trip partner of the
// serialiser, so a consumer can reload the canonical file without re-deriving.
export function parseClaimsJsonl(jsonl: string): Claim[] {
  return jsonl.split('\n').filter(line => line.trim() !== '').map((line, index) => {
    const parsed = parseJsonObject(line, `claims.jsonl record ${index + 1}`) as {
      layer: Claim['layer']; rawSubject: string; predicate: string; object: string;
      sourceFile: string; ordinal: number; vintage: string; rule?: string;
      position?: SourcePosition; viewAnchor?: ViewAnchor;
    };
    const claim: Claim = {
      layer: parsed.layer,
      rawSubject: parsed.rawSubject,
      predicate: parsed.predicate,
      object: parsed.object,
      provenance: { sourceFile: parsed.sourceFile, ordinal: parsed.ordinal, vintage: parsed.vintage },
    };
    if (parsed.rule !== undefined) claim.rule = parsed.rule;
    if (parsed.position !== undefined) claim.provenance.position = parsed.position;
    if (parsed.viewAnchor !== undefined) claim.provenance.viewAnchor = parsed.viewAnchor;
    return claim;
  });
}

// Escape a literal for an N-Triples/N-Quads string, per the grammar: backslash,
// quote, and the control characters that have named escapes.
function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// Percent-encode the characters that are illegal in an IRI reference, so a
// source-file path or ordinal can be embedded in a URN safely.
function encodeIriSegment(value: string): string {
  return encodeURIComponent(value);
}

function observationIri(sourceFile: string, ordinal: number): string {
  return `<urn:observation:${encodeIriSegment(sourceFile)}:${ordinal}>`;
}

function predicateIri(predicate: string): string {
  // The '@' of the existence predicate is not IRI-safe; drop it for the IRI
  // form while keeping the JSONL predicate verbatim.
  return `<urn:predicate:${encodeIriSegment(predicate.replace(/^@/, ''))}>`;
}

// A thin N-Quads export. The observation is the subject node; the raw token
// travels as its own literal so the raw distinction survives into RDF; each
// attribute and each normalisation edge is a quad in a per-layer named graph.
// Derived quads additionally carry their rule as a quad, since plain N-Quads
// cannot annotate an edge without reification.
export function serialiseNQuads(claims: readonly Claim[]): string {
  const lines: string[] = [];
  const seenSubject = new Set<string>();
  for (const claim of claims) {
    const obs = observationIri(claim.provenance.sourceFile, claim.provenance.ordinal);
    const graph = `<urn:graph:${claim.layer}>`;
    if (!seenSubject.has(obs)) {
      lines.push(`${obs} <urn:predicate:rawSubject> "${escapeLiteral(claim.rawSubject)}" <urn:graph:raw> .`);
      seenSubject.add(obs);
    }
    lines.push(`${obs} ${predicateIri(claim.predicate)} "${escapeLiteral(claim.object)}" ${graph} .`);
    if (claim.rule !== undefined) {
      lines.push(`${obs} <urn:predicate:norm_rule> "${escapeLiteral(claim.rule)}" ${graph} .`);
    }
  }
  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}
