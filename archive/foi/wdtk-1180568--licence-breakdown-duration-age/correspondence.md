# FOI correspondence — "Radio amateur licence breakdown by duration held and age"

| | |
|---|---|
| **Ofcom reference** | 1900117 (acknowledged as 01900117) |
| **WDTK request** | https://www.whatdotheyknow.com/request/radio_amateur_licence_breakdown (id 1180568) |
| **Requester** | Roger Howell (WDTK user `roger_howell`) |
| **Requested** | 2024-09-30 |
| **Acknowledged** | 2024-10-03 |
| **Responded** | 2024-10-28 |
| **Outcome** | successful (age/year-of-birth withheld under s.40(2)) |
| **Data vintage** | 2024-10 (undated export, between request and response) |

## Overview

- **Asked**: datasets breaking down amateur licences by licence type and
  time-since-issue, plus licence status and licensee age/year of birth —
  with detailed bucketing guidance to pre-empt granularity objections.
- **Provided**: two Ofcom-produced CSVs (raw, ungrouped — no bucketing was
  needed):
  - **Sheet 1** — `Value,Status,Type,Reserved to Date`, 156,256 records: a
    full register snapshot carrying a **reservation-expiry column seen in
    no other publication**.
  - **Sheet 2** — `Created Date,Status,Call Sign,Original start date,
    Licence Type`, 103,720 records: per-licence rows with issue dates —
    the duration-held source.
- **Withheld**: age / year of birth, under **s.40(2)** (personal data;
  absolute exemption, no public-interest test).
- **Significance**:
  - The only known disclosure of **Reserved to Date** (when each reserved
    callsign's cooling-off expires) — pairs with the two-year 'Reserved'
    definition on the record in wdtk-596532.
  - Sheet 2's per-licence issue dates enable duration-held analysis that
    no register snapshot supports, and its 103,720 licence rows against
    sheet 1's 156,256 callsign rows quantifies the callsign-vs-licence
    gap.
  - Salesforce-era export shape (`Value`/`Created Date` column names);
    responses now arrive as CSV rather than xlsx.

## Exchange (verbatim; relay email addresses, signature boilerplate and
footer images omitted)

**2024-09-30 — request (Roger Howell):**

> Dear Office of Communications,
>
> Please provide one or more datasets detailing a breakdown of amateur
> radio licences issued, describing:
>
> - licence type, and
> - time since license was issued (or simply the date issued if that is
> easier to extract/provide).
>
> Please also include data on the following:
> - licence status (e.g., to flag reserved call signs which have not
> yet been revoked/cancelled but are still issued, and any other
> categories in use),
> - age of the licencee (or year of birth - whichever is easiest to
> extract/provide).
>
> Without seeing the raw data it is difficult to gauge if this is a
> reasonable request. For this reason, please interpret this as a request
> for data that is as close as possible (e.g., by grouping/bucketing the
> data into brackets or another technique as you deem fit).
>
> If grouping data, please use brackets/buckets which are as
> small/granular as possible, and only combine it with its nearest
> neighbour(s) where needed while keeping other brackets narrow. For
> example, if the split of "foundation licencees who have held their
> licence for three years" is deemed to be too small to split into
> single-year age groups due to, e.g. 1990, being only a single person,
> please group only the too-small brackets with a neighbour and keep the
> remainder narrow (i.e., have the age/year of birth buckets like so,
> noting that 1990 has been merged with 1991 while all other years remain
> un-merged: 1988,1989,1990-1991,1992,1993).
>
> Similarly, if the "time since licence issued" is too granular at the
> day/month level, please provide narrow groups/brackets such as < 6
> months, <1 year, >=1 and <2 years, >=2 and <3 years, etc.
> (with, perhaps, wider specific brackets such as ">=40 years and
> <45 years" if the data requires it while keeping the other brackets
> narrow).
>
> If it is not possible to include both age and duration that the
> licence has been issued in the same dataset, please consider alternative
> options such as providing a data file for each individually.
>
> Yours faithfully,
>
> Roger Howell

**2024-10-03 — acknowledgement (Information Requests, Ofcom;
reference 01900117):**

> Dear Roger Howell,
>
> Thank you for your request for information about Radio amateur licence
> breakdown by duration held and age. Your request was received on
> 30/09/2024.
>
> Where we hold the information you have requested we will endeavour to
> answer your request in full and within 20 Working Days.
>
> If we are unable to provide the information requested, we will explain
> why the information has not been provided.

**2024-10-28 — response (Information Requests, Ofcom), with
`FOI 1900117 … .pdf` and the two dataset CSVs attached (plus nine
signature images, omitted as spurious):**

> Dear Mr Howell
>
> Please see the attached response to your Freedom of Information request
> to Ofcom.
>
> Regards
>
> Information requests
