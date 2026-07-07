# FOI correspondence — "Issued and available UK amateur radio callsigns"

| | |
|---|---|
| **Ofcom reference** | 756622 (acknowledged as 00756622) |
| **WDTK request** | https://www.whatdotheyknow.com/request/issued_and_available_uk_amateur (id 596532) |
| **Requester** | Roger Howell (WDTK user `roger_howell`) |
| **Requested** | 2019-08-09 (received 2019-08-12) |
| **Acknowledged** | 2019-08-14 |
| **Responded** | 2019-09-06 |
| **Outcome** | successful |
| **Data vintage** | **2019-08-12** ("as at the date of your request", per the letter; the filename says only "Aug19") |

## Overview

- **Asked**: a dataset of every valid callsign with licence class and issue
  status — or the components to derive one: (1) valid formats per class,
  (2) forbidden suffixes, (3) reserved/allocated callsigns; plus any rules
  making a format-valid, unforbidden, unallocated callsign nevertheless
  unavailable.
- **Provided**: `Allocated reserved forbidden Call Sign FOI Aug19.xlsx` —
  allocated+reserved callsigns with class (~141,295 rows) and the
  Forbidden Call Signs tab (~1,466 rows); format rules by signpost to the
  published page.
- **Withheld**: nothing — the availability list does not exist as a thing
  to withhold (availability is definitional, see below).
- **Significance** (on the record — see the raw extract):
  - **The official status definitions**: 'Allocated' = currently assigned
    to a station; 'Reserved' = used within the past two years, "cooling
    down", re-appliable after the two-year period — the semantics behind
    the Status column of every register snapshot.
  - **Availability is definitional, not enumerated**: not allocated, not
    reserved, not forbidden, format-compliant ⇒ "by default available".
  - **Data-quality anomalies put on the record by the requester's
    follow-up** (2019-09-09): of 141,295 records — six blank statuses,
    21 six-character callsigns (inconsistent country identifiers), three
    trailing non-breaking spaces, one mid-callsign space; Ofcom
    acknowledged them (2019-09-18).
  - **The periodic-publication ask and answer**: "would you consider a
    periodic public release of this data…?" — "this is something that we
    are actively considering" — the direct precursor to the open-data
    publication this repository mirrors.

## Exchange (verbatim; relay email addresses, signature boilerplate and an
out-of-office auto-reply omitted)

**2019-08-09 — request (Roger Howell):**

> Dear Office of Communications,
>
> Please provide a dataset of every valid UK radio amateur callsign, the
> licence class, and its current issue status (for example but not limited
> to: allocated, reserved, available, forbidden, otherwise unavailable for
> a new licence application).
>
> Alternatively, please provide the relevant data that would be enable the
> derivation of such a dataset. I believe that such data would include at
> minimum:
>
> 1) a list of all valid formats with corresponding licence class,
> 2) a list of all forbidden suffixes, and
> 3) a list of all currently reserved/allocated callsigns.
>
> If there are any cases where a callsign meets the valid formats in (1),
> is not a forbidden callsign (2), and is not reserved/allocated (3) but is
> still unavailable to be issued, please provide details of the rules
> and/or restrictions that apply.
>
> Yours faithfully,
>
> Roger Howell

**2019-08-14 — acknowledgement (Jerin John, Information Requests, Ofcom;
reference 00756622):**

> Dear Roger Howell,
>
> Thank you for your request for information about Issued and available UK
> amateur radio callsigns. Your request was received on 12/08/2019.
>
> Where we hold the information you have requested we will endeavour to
> answer your request in full and within 20 Working Days.
>
> If we are unable to provide the information requested, we will explain
> why the information has not been provided.

**2019-09-06 — response (Julia Snape, Ofcom), with
`Amateur Radio callsigns Howell.pdf` and the dataset
(`Allocated reserved forbidden Call Sign FOI Aug19.xlsx`) attached:**

> Dear Mr Howell
>
> Please find attached our response to your request for information.
>
> Kind regards
>
> Julia

**2019-09-09 — follow-up (Roger Howell):**

> Dear Julia Snape / Jerin John,
>
> Thank you for your helpful and complete reply - the data and the
> accompanying cover letter is much appreciated.
>
> I have yet to analyse the data fully, though a cursory initial inspection
> shows that of the 141,295 records:
>
> * There are six records which have a blank status.
> * There are 21 records which have callsigns of length of six characters
> (e.g. where country identifiers have been included inconsistently).
> * There are three records which have a trailing non-breaking space in the
> callsign column.
> * There is one record with a space in the middle of the callsign.
>
> While I am happy to inspect and clean the data before analysing further
> given that these comments relate to only an extremely small minority of
> records, I raise these to your attention so that you may consider
> amending/correcting/cleaning the source data.
>
> Finally, would you consider a periodic public release of this data -
> perhaps monthly, bimonthly, or quarterly?
>
> Yours sincerely,
>
> Roger Howell

**2019-09-18 — reply (Julia Snape, Ofcom):**

> Dear Mr Howell
>
> Thank you for your email dated 9 September. I appreciate you bringing to
> our attention the anomalies in the reports, we will look at these when we
> have the opportunity.
>
> On the periodic publication of the data, this is something that we are
> actively considering.
>
> Kind regards
> Julia
