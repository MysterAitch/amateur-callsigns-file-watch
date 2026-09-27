# UK amateur callsign structure (current system)

The system as **implemented** following Phases 2–3 of Ofcom's licensing
review (October 2025). Primary authority throughout: Ofcom's *Amateur radio
guidance*, updated 14 October 2025 (mirrored in
[`sources/`](sources/amateur_radio_licence_guidance_for_licensees.pdf));
section and page references are to that document unless stated.

## Anatomy of a callsign

```
  [RSL optional]
      │
  M │W│ 7 ABC / P
  ──┘ │ ─ ─── ─────
prefix│ │  │     └ suffix after "/" (optional, self-selected: /P, /M, /A, /MM, /AM …)
letter│ │  └ trailing letters ("suffix" in Ofcom's core-callsign sense; normally three)
      │ └ single digit
      └ Regional Secondary Locator
```

Terminology note: Ofcom uses *suffix* for both the trailing letters of the
core callsign (§5.3) and the post-slash operational additions (§5.8). Where
ambiguous, this project says *trailing letters* and *slash suffix*.

## Initial characters and what they denote

> "The call signs that Ofcom issues for normal operation under the Amateur
> Radio Licence are made up of an initial character 'G' or 'M' (denoting that
> a station is authorised by the UK), followed by a number and then, normally,
> three letters. Very old call signs, some of which remain in use, have only
> two trailing letters. A call sign with only two trailing letters or which
> starts with 'G2' is only available if the applicant previously held it."
> — §5.2, p. 18

The underlying prefix blocks are allocated to the UK by the ITU; Ofcom
"cannot authorise call signs which have not been allocated to the UK"
(Statement, §3.31). Per the ITU call-sign-series table (Appendix 42 to the
Radio Regulations; mirrored export in
[`sources/`](sources/itu-call-sign-series-appendix42.xlsx)), the UK holds the
complete `2AA–2ZZ`, `GAA–GZZ`, and `MAA–MZZ` blocks — every second-letter
combination, which is what makes arbitrary RSL letters possible — plus
overseas-territory series (`VP/VQ/VS`, `ZB–ZJ`, `ZN/ZO/ZQ`) that do not
appear in the amateur register this repository mirrors.

### Table 1 — call sign formats by station level (§5.2, p. 18)

| initial characters | station level | status |
|---|---|---|
| M3, M6, M7 | Foundation | currently issuing |
| M8, M9 | Intermediate | currently issuing |
| 2#0, 2#1 (`#` = mandatory RSL) | Intermediate | formerly issued; holders may retain |
| M0, M1, M5, G1, G3, G4, G5, G6, G7, G8, G0 | Full | currently issuing |
| G2 | Full | formerly issued; only re-issued to a previous holder |

Club licences (Full (Club)) use "an initial character 'G' or 'M', followed by
three letters", with two-letter forms only where "the club can prove the call
sign heritage and connection to the Club" (§5.2, p. 18). *(Note: as printed,
this sentence omits the digit; club callsigns in the wild have the familiar
letter–digit–letters shape with a club RSL, e.g. `GX`, `MX` — see Table 2.)*

## Regional Secondary Locators (§5.7, pp. 20–21)

> "An RSL enhances the 'core' call sign of an Amateur Radio Licence. They are
> used to indicate the UK nation (or Crown Dependency) in which a station is
> operating. The use of RSL's, in most cases, is now optional for licensees."

> "The licence does not require the use of an RSL except in the case of
> Intermediate stations that utilise a '2' format call sign. This is because,
> without an RSL, the format of these call signs (e.g., '20aaa') does not
> confirm to the requirements set out in the Radio Regulations." *(sic —
> "confirm" is the source's typo for "conform")*

The RSL sits between the initial letter and the digit (`M7ABC` → `MW7ABC`),
or after the `2` (`2W0ABC`). **Consequence for this repository's data**: a
bare `20…`/`21…` value in an Ofcom export is not a Radio-Regulations-conformant
callsign — it is the core callsign stored without its mandatory-in-use RSL.

### Table 2 — RSLs (§5.7, p. 20; club letters cross-checked against RSGB prefix table)

| region | all licences | Full (Club) only |
|---|---|---|
| England | E | X |
| Guernsey | U | P |
| Isle of Man | D | T |
| Jersey | J | H |
| Northern Ireland | I | N |
| Scotland | M | S |
| Wales | W | C |

England's `E` became available to all licence classes in the review
(Statement, Q4 decision: "Introduce optional use of the RSL 'E' for all
licence classes when operating in England"). Before that, `E` appeared only
in Intermediate `2E…` callsigns.

### Temporary RSLs (§5.7.1, pp. 20–21)

Ofcom "sometimes issue[s] temporary RSLs to mark special occasions", notified
via its website, available "for no more than one year". Example given: "the
use of 'Q' to mark the period of national mourning in 2022". (Wikipedia
additionally records historic special SES prefixes GQ, GO, GR, MQ, GA, MO,
2O "issued in special cases".)

## Slash suffixes (§5.8, p. 21)

> "Any suffix, following the 'slash' ('/') symbol may be added to the
> transmitted call sign, so long as the station remains identifiable."

Conventional examples given: `/A`, `/M`, `/MM`, `/P`, `/AM`. Suffixes "are
not mandated by, or referenced in, the amateur radio licence" and do not form
part of the core callsign — so they should not appear in Ofcom's callsign
register data (and a value containing `/` in the *register* is a visitor
format or an anomaly, not a slash suffix).

Community sources add that the trailing letters of the core callsign cannot
begin with `Q` (Q-code confusion; G3LRS club page) — this restriction is not
stated in the Ofcom guidance's callsign chapter, so it is recorded here as
community knowledge pending a primary citation (candidate: the forbidden
composition rules referenced alongside the withheld-callsign footnote, §5.4.1
fn. 5: a callsign is available "if it is in the correct format for the class
of licence, is not withheld (for example because it is offensive) …").

## Special station formats

From the 14 Oct 2025 implementation guidance (p. 2) and OARC's UK-callsigns
page (CC BY-SA):

- **Special Event Stations**: liberalised October 2025 — "call signs to a
  maximum 6 characters in length, in the format `GBdccccca' (d = digit other
  than 3 or 7, c = digit or letter, a = letter) … as long as they start 'GB'"
  (Guidance, p. 2; the format string as printed is internally inconsistent
  with the 6-character maximum — treat the constraints "starts GB, ≤6 chars,
  digit ≠ 3 or 7, ends in a letter" as the intent). GB3/GB7 are excluded
  because they identify repeaters and beacons.
- **Analogue voice repeaters**: `GB3` + two letters; **beacons**: `GB3` +
  three letters; **digital voice repeaters**: `GB7` + two letters;
  **gateways/data**: `MB7` + letters (OARC).
- **Special contest callsigns**: single-letter trailing form (`G#X`/`M#X`)
  available to Full licensees via NoV (guidance §6.4).

## Assignment, change, and re-issue rules (§§5.3–5.6, pp. 18–20)

- Applicants may choose prefix and trailing letters, subject to availability.
- Callsign changes: "once every 5 years" for most licensees; Intermediate
  holders moving from `2` format to M8/M9 are exempted from that limit
  (implementation guidance, p. 3).
- One personal licence (and callsign) per person; progressing revokes the
  lower licence (October 2025 change).
- Relinquished callsigns rest for **five years** before re-issue: "we will
  not make a call sign available for five years following the expiry of its
  previous use. This applies in all circumstances no matter who the
  requester is." (§5.6, p. 20)
- Availability definition (fn. 5, p. 19): "A call sign is available, if it is
  in the correct format for the class of licence, is not withheld (for
  example because it is offensive), is not currently assigned to a licensee
  and has not been in the past five years."

## Visitors and reciprocal operation

Visiting amateurs under CEPT T/R 61-01 use their home callsign with UK
identification; the `M/`-prefixed forms observed in the register (e.g.
`M/PT2FM`) reflect Full (Temporary Reciprocal) arrangements — the guidance
covers qualifying routes in §2.1.4 and operating abroad in §7. (The
register's `M/` rows are a distinct population for parsing purposes: UK
visitor marker + home callsign.)
