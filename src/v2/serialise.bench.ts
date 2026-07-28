import { bench, describe } from 'vitest';
import { serialiseClaimJsonlLine } from './serialise.ts';
import type { Claim } from './claim.ts';

// Microbenchmarks for the ledger line serialiser (issue #1004).
//
// WHY A REAL HARNESS RATHER THAN A LOOP AND A TIMER. Serialisation is ~41-43% of
// the ledger emit, which is itself ~45% of the golden-master job, so this is the
// single hottest routine in the pipeline. It has been "benchmarked" before with
// ad hoc timing loops, and the conclusion (V8's JSON.stringify beats every
// hand-rolled alternative) has been quoted since as settled. A hand-rolled loop
// cannot see warmup, JIT tiering, GC pauses or outliers, so it cannot tell a 5%
// real difference from 5% noise.
//
// `vitest bench` runs on tinybench, which handles warmup, repeated samples and
// per-task statistics, and supports `--outputJson` / `--compare` so a result can
// be recorded and re-checked when Node or V8 moves under us. No new dependency:
// both already ship with vitest.
//
// REGIME MATTERS, and it is the reason this file is worth having rather than
// citing the old number. Coverage instrumentation is NOT neutral between these
// candidates: istanbul instruments user JS statement by statement while
// JSON.stringify is native C++ and receives none, so ANY benchmark run under
// instrumentation systematically flatters the builtin. Run this WITHOUT
// coverage - the regime production actually uses.

function makeClaim(i: number): Claim {
  return {
    layer: 'derived',
    rawSubject: `M7ABC${i}`,
    predicate: 'callsign/status',
    object: 'Issued to a licensee',
    rule: 'parse-attribute',
    provenance: {
      sourceFile: 'archive/open-data/2026-06-23/normalised.csv',
      ordinal: i,
      vintage: '2026-06-23',
    },
  } as Claim;
}

// Enough distinct claims that the engine cannot cache a single shape's result,
// few enough that the array itself stays out of the measurement.
const CLAIMS = Array.from({ length: 2000 }, (_, i) => makeClaim(i));

// Candidate B: build the JSON text directly, deferring to JSON.stringify only
// for the values that may need escaping. This is the shape previously reported
// as slower; it is kept so the claim stays falsifiable rather than remembered.
function handRolled(claim: Claim): string {
  let out = '{"layer":' + JSON.stringify(claim.layer)
    + ',"rawSubject":' + JSON.stringify(claim.rawSubject)
    + ',"predicate":' + JSON.stringify(claim.predicate)
    + ',"object":' + JSON.stringify(claim.object)
    + ',"sourceFile":' + JSON.stringify(claim.provenance.sourceFile)
    + ',"ordinal":' + claim.provenance.ordinal
    + ',"vintage":' + JSON.stringify(claim.provenance.vintage);
  if (claim.rule !== undefined) out += ',"rule":' + JSON.stringify(claim.rule);
  if (claim.provenance.position !== undefined) out += ',"position":' + JSON.stringify(claim.provenance.position);
  if (claim.provenance.viewAnchor !== undefined) out += ',"viewAnchor":' + JSON.stringify(claim.provenance.viewAnchor);
  return out + '}';
}

describe('ledger line serialisation', () => {
  bench('current — object literal + JSON.stringify', () => {
    for (const claim of CLAIMS) serialiseClaimJsonlLine(claim);
  });

  bench('hand-rolled concatenation', () => {
    for (const claim of CLAIMS) handRolled(claim);
  });
});

// The phase the line serialiser cannot reach. The emit profile records UTF-8
// encoding as a SEPARATE 14-15% phase, which exists only because a JS string is
// materialised first. Encoding straight into a reused buffer would delete that
// phase rather than speed it up - a different lever from any serialiser choice,
// and the one no previous comparison has tested.
describe('string materialisation vs direct byte encoding', () => {
  const lines = CLAIMS.map(serialiseClaimJsonlLine);
  const encoder = new TextEncoder();
  const scratch = new Uint8Array(1 << 20);

  bench('materialise a string, then Buffer.from', () => {
    Buffer.from(lines.join('\n'), 'utf8');
  });

  bench('encodeInto a reused buffer, no intermediate joined string', () => {
    let offset = 0;
    for (const line of lines) {
      const { written } = encoder.encodeInto(line, scratch.subarray(offset));
      offset += written + 1;
      if (offset >= scratch.length - 1024) offset = 0;
    }
  });
});
