# Local holdings — public index of withheld bytes

This directory implements the settled #618/#619 policy for copies whose
**redistribution** basis is not (yet) cleared.

The acquisition posture is that opportunistic **fetching** is unrestricted —
retrieving a copy is equivalent in kind to viewing it in a browser. What is
gated is **upload/redistribution**, which is always a deliberate, manual,
per-item decision.

So where the mirror has fetched a copy it cannot yet redistribute, the bytes are
held locally under `bytes/` — **gitignored, never committed** — and their
existence is recorded publicly in [`index.json`](index.json):

- `sha256`, `bytes` — so anyone can obtain their own copy and verify it is the
  same bytes;
- `originalFilename`, `publisher`, `obtainFrom`, `fetchedAt` — the provenance and
  the pointer to obtain-and-verify;
- `withheldReason` — the uncleared basis that keeps the bytes out of the repo.

No public claim rests on bytes the public cannot check: the index is the public
record of availability, and any conclusion drawn from a withheld copy is marked
as derived from a non-redistributed copy, verifiable by obtaining the file from
its source. If a source becomes unobtainable, the index records that honestly —
and that event is the trigger for the manual, per-item rehost-under-accepted-risk
decision.

The index is written and updated by
[`src/tools/collect-witness.ts`](../../src/tools/collect-witness.ts)
(`--local-only`).
