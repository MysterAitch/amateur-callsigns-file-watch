# UK licence classes and callsign series — history

The Foundation/Intermediate/Full ladder is recent. For most of the hobby's
history the UK issued **Class A** and **Class B** licences (distinguished
chiefly by a Morse proficiency requirement), later joined by **Novice**
classes, restructured in 2001–2004 into today's three levels. Callsign series
map onto these eras, which is why the series a callsign belongs to often
reveals roughly *when* — and under what regime — it was first issued.

Sources here are largely secondary (series-date tables from Electronics
Notes and M0YBC — near-identical, so treated as one lineage, not two
confirmations; OARC wiki; attributed forum recollections). Primary documents
for each era exist in the [OARC UK licence archive](https://wiki.oarc.uk/uk-licence-archive)
(licence documents from 1907, BR68 variants, Class A/B terms) and remain the
verification path for anything load-bearing.

## Era timeline

| era | classes | Morse requirement |
|---|---|---|
| pre-WWII | experimental/transmitting licences; two-letter series | — |
| 1946 – 1964 | Class A (as G3+3 etc.) | yes |
| 1964 – 2003 | **Class A** (HF + VHF) vs **Class B** (VHF/UHF only) | Class A: 12 wpm; Class B: none |
| 1991 – 2001 | + **Novice A / Novice B** (`2#0`/`2#1`) | Novice A: 5 wpm |
| 2001 – 2004 | phased restructure → **Foundation / Intermediate / Full** | removed: "In 2003: 'CEPT S25 was amended to remove the Morse requirement entirely.'" (G3LRS) |
| 2024 – 2025 | same three levels; licensing review reshapes callsign policy (see [m8-m9-transition.md](m8-m9-transition.md)) | — |

Class details, as recalled in the SOTA Reflector thread (posts © their
authors): ZL4NVW described "A and B class licenses" requiring "2 city &
guilds papers", with Class B "30MHz+ only" and Morse success giving "class A
and HF"; GM4LLD clarified the Novice era — 2E1 (1992–2003) was "Amateur Radio
Novice Licence Class (B)… VHF only on limited bands original 3W later 10W
power", 2E0 the "Novice Licence Class (A) which had HF privileges" — and the
M5 series: "the special easy HF licence" requiring "only a 5WPM Morse test
not 12WPM", with a "100W limit on HF", whose "HF privileges were not CEPT
recognised". MW0PJE noted the modern addition: "Very recently the RSGB have
introduced a 'direct to full' exam".

G3LRS (club page) dates Class A/B to 1964–2003 with Class A requiring a
"12wpm Morse code test in addition to a passing grade in the RAE"; Class B
initially "over 430Mhz" only, later extended down through 144/70/50 MHz.

## Callsign series and issue dates

Compiled from Electronics Notes / M0YBC (single lineage — dates below are
theirs unless noted) with OARC wiki cross-checks. Dates are community
records, **not** verified against primary documents; discrepancies are noted.

### Pre-war two-letter series (Full-equivalent)

| series | dates | notes |
|---|---|---|
| G2 + 2 letters | 1920–1939 | "Artificial Aerial" licences (Electronics Notes) |
| G5 + 2 letters | 1921–1939 | |
| G6 + 2 letters | 1921–1939 | |
| G8 + 2 letters | 1936–1937 | |
| G3 + 2 letters | 1937–1938 | |
| G4 + 2 letters | 1938–1939 | |

OARC adds context: "1927: UK obtained M, G, and 2 prefixes from ITU"; before
1991 only `G` was used for amateur issue. Regional prefixes: "1937: GM
(Scotland) and GW (Wales) introduced; 1946: GC created for Channel Islands;
1977: GC replaced by GU (Guernsey) and GJ (Jersey)" (OARC, CC BY-SA).

### Post-war three-letter series

| series | dates | class at issue |
|---|---|---|
| G3 + 3 letters | 1946–1971 | Class A |
| G8 + 3 letters | 1964–1981 | Class B |
| G4 + 3 letters | 1971–1985 | Class A |
| G6 + 3 letters | 1981–1983 | Class B |
| G1 + 3 letters | 1983–1988 | Class B |
| G0 + 3 letters | 1986–1996 | Class A |
| G7 + 3 letters | 1989–1996 | Class B |
| M0 + 3 letters | 1996– | Class A → now Full |
| M1 + 3 letters | 1996– | Class B at issue; "now used for new full licences" (Electronics Notes) |
| M5 + 3 letters | 2001– | the 5 wpm HF licence (GM4LLD, above) → now Full |

### Novice → Intermediate (`2` series)

| series | dates | notes |
|---|---|---|
| 2#0 + 3 letters | from 1991 | Novice A → Intermediate; RSL mandatory (`#`) |
| 2#1 + 3 letters | from 1991 | Novice B → Intermediate; RSL mandatory |

Date discrepancy worth recording: Electronics Notes/M0YBC say "issued from
1991"; GM4LLD (SOTA) recalls 2E1 as "1992–2003" for the *Novice B* class
specifically — both can be true if the scheme launched 1991 with first issues
into 1992. The series continued for Intermediate until the M8/M9 change
(ceased for new issue, 2025).

### Foundation

| series | dates |
|---|---|
| M3 + 3 letters | 2002 (Foundation launch era) |
| M6 + 3 letters | "Available from 13 May 2008" (M0YBC/Electronics Notes) |
| M7 + 3 letters | 2018 |

### Intermediate (current)

| series | dates |
|---|---|
| M8, M9 + 3 letters | from October 2025 (see [m8-m9-transition.md](m8-m9-transition.md)) |

## Reading a callsign's vintage — practical notes for this repository

- Two trailing letters, or a `G2` prefix, marks a pre-war-lineage callsign
  that has been continuously held or reclaimed ("only available if the
  applicant previously held it" — Ofcom guidance §5.2).
- The class *at issue* is not the class *now*: a G8 was Class B at issue but
  its holder today holds a Full licence. Cross-checking callsign series
  against the register's `product` column therefore needs era awareness —
  e.g. `M1…` + Full is expected, and the register's product strings only
  encode today's three levels.
- The `2#0`/`2#1` → M8/M9 correspondence is per-callsign (see the transition
  document), so future datasets may show the same suffix migrating between
  prefixes — a row-identity consideration for cross-publication matching.
