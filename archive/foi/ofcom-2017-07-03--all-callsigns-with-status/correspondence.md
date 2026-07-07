# FOI publication record — all callsigns with status (request of 2017-07-03)

| | |
|---|---|
| **Ofcom reference** | not stated anywhere in the published letter |
| **Publication channel** | Ofcom FOI-responses pages (`www.ofcom.org.uk/__data/assets/pdf_file/0020/106283/Amatuer-Radio-Callsigns.pdf` and `…/pdf_file/0005/101300/Copy-of-Call-Signs.pdf`) |
| **Recovered from** | UK Government Web Archive, capture 2020-04-10 |
| **Requested** | 2017-07-03 (year fixed by the letter PDF's creation metadata, 2017-09-11) |
| **Responded** | ~2017-09-11 (no date in the letter text; from PDF creation metadata) |
| **Outcome** | successful (systems questions answered; register list attached) |
| **Requester** | not named (redacted by Ofcom for publication); no matching WDTK thread known |
| **Data vintage** | **2017-04-24** (the attached list's PDF creation metadata — an export ~4.5 months older than the request) |

## Overview

- **Asked** (four questions): the requirements/specification/design
  documentation for the new callsign database system; whether a
  status-bearing callsign list exists in any form; which database system
  manages allocation; and the full list of callsigns with status.
- **Provided**:
  - **"Ofcom uses Salesforce as its licencing database"** — the explicit,
    twice-stated naming of the post-2016 system (the documentation asked
    for in Q1 was answered only with the product name).
  - The fullest description of the assignment algorithm on the record:
    format matching per licence type; compliance with **Article 19 and
    Appendix 42 of the Radio Regulations**; a recent-past-use check; and a
    distress-format check ("in which case the call sign is not assigned").
  - The online applicant flow: choose → check → assign or notify → retry
    "until the system finds one that is not assigned".
  - `Copy-of-Call-Signs.pdf` — the register list **as a printed-to-PDF
    Excel export** (~11.6 MB; PDF authored by Julia Snape from Excel,
    created 2017-04-24).
- **Withheld**: nothing stated — but note Q1's documentation ask received
  a one-line answer rather than documents or a refusal.
- **Significance**: the keystone Salesforce-era document for the systems
  chronology (issue #129) — it names the platform, dates the era's public
  confirmation (2017), details the generator's rule set, and demonstrates
  register exports being reused across months (April export answering a
  July request). Also a format datum: a register disclosed as PDF rather
  than spreadsheet — converter-hostile, and the only known instance.

## Exchange

The exchange consists of the single published letter (see the raw
extract); the four questions are quoted within it. No requester-side
thread is known.
