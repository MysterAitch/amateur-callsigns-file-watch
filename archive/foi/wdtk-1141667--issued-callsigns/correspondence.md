# FOI correspondence — "Listing of UK Amateur Radio Callsigns"

| | |
|---|---|
| **Ofcom reference** | 01842686 |
| **WDTK request** | https://www.whatdotheyknow.com/request/listing_of_uk_amateur_radio_call (id 1141667) |
| **Requester** | Andy Pursell (WDTK user `andy_pursell`) |
| **Requested** | 2024-06-24 |
| **Acknowledged** | 2024-06-25 |
| **Responded** | 2024-07-22 |
| **Outcome** | successful |
| **Data vintage** | 2024-07-22 (the date the report was generated from Ofcom's systems) |

## Overview

- **Asked**: a listing of all amateur radio callsigns currently in the Ofcom
  database that have been issued, with licence class, issue status and a
  last-modified/updated field where available.
- **Provided**: one Ofcom-produced workbook, `Annex 1 All callsigns.xlsx`
  (`Call Sign,Product__c,Status__c,Type__c,LastModifiedDate`, 110,622 data
  rows), plus a covering response letter as a PDF.
- **Significance**:
  - A distinct, previously unheld disclosure — **not** a copy of the held
    `ofcom-2024-07--call-signs--all-callsigns` open-data snapshot of the same
    month. This WDTK export is an **issued-scope** projection: every row
    carries a licence product (no blank-product pool), so it holds 110,622
    rows against the open-data snapshot's 155,346, and only 9,792 Reserved
    against that snapshot's 51,955 — the reserved-without-a-product pool the
    open-data copy carries is absent here.
  - Salesforce-flavoured export shape whose headers carry the source system's
    own custom-field names (the `__c` suffix), distinct from every other held
    export including the later 2025-09-11 workbook.
  - The response letter records the scope explicitly: it excludes callsigns
    with a `revoked` status (revoked callsigns instead carry a `reserved`
    status for two years) and excludes forbidden-suffix callsigns (which were
    never issued).

## Exchange (verbatim; relay email addresses and signature/footer boilerplate omitted)

**2024-06-24 — request (Andy Pursell):**

> Dear Office of Communications,
>
> Under the terms of the Freedom of Information Act, could you please provide
> me with a listing of all the amateur radio callsigns that are currently in
> the Ofcom database.
>
> The dataset should include valid UK radio amateur callsigns, that has been
> issued, Please include the following metadata where available
>
> * Licence Class; Foundation, Intermediate or Full
> * Issue Status; allocated, reserved, available, forbidden, revoked
> * Last Modified/Updated
>
> Yours faithfully,
>
> Andy Pursell

**2024-06-25 — acknowledgement (Information Requests, Ofcom; reference 01842686):**

> Dear Andy Pursell,
>
> Thank you for your request for information about the listing of UK Amateur
> Radio Callsigns. Your request was received on 24/06/2024.
>
> Where we hold the information you have requested we will endeavour to answer
> your request in full and within 20 Working Days.
>
> If we are unable to provide the information requested, we will explain why
> the information has not been provided.

**2024-07-22 — response (Information Requests, Ofcom; reference 01842686), with
`Annex 1 All callsigns.xlsx` and `The listing of UK Amateur Radio Callsigns.pdf`
attached (plus seven signature images, omitted as spurious):**

> Dear Andy Pursell,
>
> Freedom of Information request: Right to know request
>
> Thank you for your request for information about the listing of UK Amateur
> Radio Callsigns.
>
> We received this request on 24 June 2024 and we have considered your request
> under the Freedom of Information Act 2000 ("the FOI Act").
>
> Your request
>
> "Under the terms of the Freedom of Information Act, could you please provide
> me with a listing of all the amateur radio callsigns that are currently in
> the Ofcom database.
>
> The dataset should include valid UK radio amateur callsigns, that has been
> issued, Please include the following metadata where available
> * Licence Class; Foundation, Intermediate or Full
> * Issue Status; allocated, reserved, available, forbidden, revoked
> * Last Modified/Updated"
>
> Our response
>
> Please find attached a list of all the amateur radio callsigns that are
> currently held by Ofcom, as of 22 July 2024, which is the date a report was
> generated from our systems. This list in annex 1 shows the amateur callsigns
> which have been issued and includes their license class, issue status
> (allocated, reserved and available) and the date they were last modified. We
> do not hold a list of completely new callsigns which have never been
> previously allocated as our system generates new callsigns on demand.
>
> Please note, if a license is revoked, the callsign will have a reserved
> status for 2 years until it can be issued again (conditions apply).
> Therefore, this attached list contains no entries with the status 'revoked'.
>
> Similarly, as callsigns which include forbidden suffixes will never have been
> issued, we have also not included any forbidden callsigns.
>
> We hope this information is helpful. If you have any further queries, then
> please send them to information.requests@ofcom.org.uk — quoting the reference
> number above in any future communications.
>
> Yours sincerely,
>
> Information Requests
