# The 2023–2025 licensing review: M8/M9 and optional RSLs

The changes most relevant to this repository's data: Intermediate callsigns
moved from the `2` series to `M8`/`M9`, and Regional Secondary Locators
became optional. Every claim below is tagged **proposed** / **decided** /
**implemented** — the review's decisions (December 2023) and their
implementations (February 2024 and October 2025) differ in both timing and
occasionally detail, so the tags matter.

## Timeline

| date | event | status |
|---|---|---|
| June 2023 | Ofcom consultation *Updating the amateur radio licensing framework* | proposed |
| **11 December 2023** | Ofcom **statement** — decisions on all consultation questions (mirrored: [`sources/ofcom-statement…2023-12.pdf`](sources/ofcom-statement-updating-amateur-radio-licensing-framework-2023-12.pdf)) | decided |
| 21 February 2024 | Phase 1: new licence conditions in force (community record: Essex Ham, "New Licence Conditions Now In Effect") | implemented (Phase 1) |
| 2024–2025 | Phases 2–3 delayed (community record: Essex Ham, "Ofcom delays 2024/25 licensing changes") | — |
| **14 October 2025** | Ofcom guidance *Implementing Phase 2 and 3 of the Amateur Review* (mirrored: [`sources/ofcom-guidance…2025-10.pdf`](sources/ofcom-guidance-amateur-radio-phase-2-and-3-review-2025-10.pdf)); RSGB reports implementation 17 October 2025 | implemented (Phases 2–3) |

## M8/M9 replacing the `2` series

**Decided** (Statement, Q3 decision box, p. 18):

> "1) We will cease assigning call signs starting with '2' to Intermediate
> stations, instead issuing call signs starting with 'M8' or 'M9'. We will
> take this approach in all cases.
> 2) To facilitate existing licensees wishing to move to the new format;
> where a call sign is on issue in the current format, we will reserve the
> corresponding call sign in the new format **for a period of three years**.
> It is important to note that this is not mandatory and those who wish to
> continue using their existing '2' call sign can do so, whilst continuing to
> insert the RSL into their call sign when transmitting."

The statement also notes (§3.29): "for those who already hold an Intermediate
call sign, this change is optional… Intermediate Licence holders may retain
their current '2' format call sign." A footnote (12) adds the condition:
"Where they continue to hold the licence."

**Implemented** (Guidance, 14 October 2025, p. 2):

> "Intermediate M8 and M9 go live — new Intermediate licensees will now be
> able to choose an M8 or M9 call sign. Existing licensee can change their
> current 2 series call sign to the corresponding M series. For 2#0 call sign
> holders we have reserved the corresponding M8 call sign and 2#1 the M9)
> via the online portal." *(the `#` placeholders render as blanks in the PDF
> text layer; quoted per the visible intent)*

So the correspondence mapping is: **`2#0xyz` → `M8xyz`** and
**`2#1xyz` → `M9xyz`** (RSL dropped, digit 0→8 / 1→9, trailing letters kept).

### The reservation window — verified, with one caveat

- The **duration** — three years — is stated only in the December 2023
  decision. The October 2025 implementation guidance confirms reservations
  are operational but does **not** restate the duration or an end date.
- The **anchor date** is not explicit in either document. Reading the
  decision's purpose (facilitating moves to a format that only became
  requestable at go-live), the natural anchor is implementation — giving an
  expected window of roughly **October 2025 → October 2028**. An anchor of
  the decision date (December 2023 → December 2026) would have consumed most
  of the window before the portal could act on it, which argues against that
  reading — but this is **inference, not sourced fact**. If the end date ever
  becomes load-bearing (e.g. for predicting register churn), confirm with
  Ofcom directly.

### Consequences for this repository's data

- Expect `M8`/`M9` rows to appear in publications fetched after October 2025,
  growing as new Intermediates license and existing `2` holders convert.
- Conversions are per-callsign trailing-letter-preserving, so
  cross-publication row identity can, in principle, follow a licensee across
  the change (`2E0XYZ` disappearing while `M8XYZ` appears).
- `2` rows will persist indefinitely (retention is allowed), but the *bare*
  `20…`/`21…` forms in exports remain RSL-less core callsigns (see
  [callsign-structure.md](callsign-structure.md)).
- The single-personal-licence change (October 2025) triggers "automatic
  revocation of lower licence call signs" on progression (RSGB, 17 Oct 2025)
  — expect elevated `Reserved`/disappearance churn in publications after
  late 2025.

## RSLs made optional

**Decided** (Statement, Q4 decision box, p. 21):

> "1) Remove the mandatory requirement to use an RSL when operating from the
> licence, making the use of RSLs optional;
> 2) Introduce optional use of the RSL 'E' for all licence classes when
> operating in England; and
> 3) Amend the amateur radio licence to allow licensees to use any special
> RSL as notified by Ofcom to mark special occasions in the UK."

With the boundary condition: "RSLs would only remain compulsory in cases
where Intermediate licensees continue to use a '2' format call sign"
(fn. 16 continuation, p. 21).

**Implemented**: the 14 October 2025 licence guidance §5.7 states the
current position ("The use of RSL's, in most cases, is now optional") — see
[callsign-structure.md](callsign-structure.md) for the full current rules.

Community colour on the debate (Statement §§3.36–3.39): supporters cited
simplification and mobile border-crossing; objectors cited national identity
and the ambiguity of one licensee alternating `GM7ABC`/`G7ABC`. Ofcom's
position: "The core call sign does not include an RSL, as this may change
depending on where in the UK a radio amateur is transmitting from" (§3.42) —
which is precisely why Ofcom's register exports store RSL-less roots.

## Other review outcomes relevant to the register

(All **implemented** October 2025 per the guidance, p. 2:)

- Callsign changes on request "once every 5 years", with surrendered/revoked
  callsigns resting five years.
- Single personal licence per person, lower licences revoked on progression.
- Licences revoked for failure to revalidate every five years — a new
  mechanism that will remove stale records from the licensed population over
  time.
- Liberalised Special Event callsigns (`GB…`, ≤6 characters, first digit ≠
  3/7).
