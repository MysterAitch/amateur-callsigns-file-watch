# Raw extract — `Amatuer-Radio-Callsigns.pdf` (response letter)

Mechanical text extraction (2026-07-07) of the letter as published on
Ofcom's FOI-responses pages (requester identity redacted by Ofcom for
publication; the asset filename's "Amatuer" typo is Ofcom's). The letter
carries **no reference number and no response date** in its text; PDF
metadata dates its creation to 2017-09-11 (author Anand Thakrar). The
original's question numbering renders every question as "1." — preserved.
Standard internal-review boilerplate footer omitted; substantive text
verbatim.

---

**Freedom of Information: Right to know request**

Thank you for your request for information dated 3 July about amateur radio
callsigns. This has been considered under the Freedom of Information Act
2000.

Please find below our response to each of your questions.

*1. I notice that OFCOM has recently changed the way it accesses its
database of amateur radio callsigns. Please send me the requirements,
specification and design documentation for the new system.*

**Ofcom uses Salesforce as its licencing database.**

*1. Does OFCOM have a list of amateur radio callsigns and their status eg
reserved, allocated, available, forbidden etc)? Note this might be on a
sheet of paper, in a spreadsheet, in an SQL database, in a non-SQL database,
in the computer code of an algorithm, etc.*

Yes we do – see 4 below.

*1. If so, which database system does OFCOM use to manage the allocation of
amateur radio callsigns? eg MS Excel, MS SQL Server, MySQL etc.*

**Ofcom are using Salesforce.** We no longer hold a list of call signs that
are available. Due to the system change, the assignment of call signs is now
done using an algorithm rather than "grabbing" from a list. **This algorithm
ensures that the call sign is in the correct format. That means that it
matches the type of licence and enables us to comply with our obligations
under Article 19 and Appendix 42 of the Radio Regulations. Our system also
checks the proposed call sign's availability for use. Availability depends
on whether or not the call sign has been used in the recent past and whether
or not it is in a format that we think may cause distress (in which case the
call sign is not assigned).**

Our licensing system will allow us to check an individual call sign's
availability. However, it is quicker for applicants who apply for an amateur
radio licence online. They may choose a call sign. If it is available, then
the system will assign it. If not, it will notify the applicant. The system
will keep allowing the customer to keep trying until the system finds one
that is not assigned.

*1. Please send me a list of all amateur radio callsigns and their status
(eg reserved, allocated, available, forbidden etc).*

Please find a list attached.

I hope this information is useful.
