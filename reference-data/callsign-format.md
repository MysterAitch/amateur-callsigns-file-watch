# Permitted call-sign format (ITU Article 19)

The authoritative definition of what characters a call sign may contain is
the ITU Radio Regulations, **Article 19, Section III** ("Formation of call
signs"). It is international treaty-level regulation; national licensing
(Ofcom) operates within it.

## What Article 19 permits

- Call signs are formed from the **letters of the alphabet** (the 26 Latin
  letters A–Z) **and figures** (the digits 0–9).
- **Accented letters are explicitly excluded.** Only the unaccented 26-letter
  Latin alphabet is permitted.
- Call signs (and other identifications) that **could be confused with a
  distress signal or other signal of a similar nature** are prohibited.

Source: ITU Radio Regulations, Article 19 §III,
<https://www.itu.int/en/ITU-R/terrestrial/fmd/Documents/fxm-art19-sec3.pdf>.

## How this grounds the mirror

The component parser treats the *plain call-sign alphabet* as `A–Z`, `a–z`,
`0–9`, plus the two notation characters this project uses — `/` (the
visitor/suffix separator) and `#` (the display-only RSL-slot marker). That
alphabet is Article 19's letters-and-figures set plus those two structural
symbols; everything else is outside a well-formed call sign. The browsers'
legible-call-sign rendering flags exactly this complement (whitespace,
control/format characters, accented letters, emoji, other symbols), so a
value carrying anything Article 19 does not permit is shown, not hidden.

## Policy is not the data — the crucial caveat

Article 19 says what a call sign *may* contain; it does **not** guarantee
what Ofcom's published data actually contains. Corruption, character-encoding
damage, spreadsheet mangling, or an automated system accepting a malformed
request could all put non-conforming characters into a register value. The
mirror's job is to surface those faithfully — the raw value is preserved
byte-for-byte, the `cleaned` join key strips to `[A-Z0-9/]` for joining, and
anything outside the permitted alphabet is **flagged, never assumed away**.
Absence of a conforming form is not evidence the value is invalid, and
presence of an odd character is recorded as an observation, not silently
corrected.
