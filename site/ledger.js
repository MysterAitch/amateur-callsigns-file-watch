// Claim-ledger preview (issue #361): renders a provenance-first view of the
// UK amateur-radio register over a curated set of real snapshots.
//
// This runs entirely in the browser over the DATA object below - an
// illustrative STATIC SNAPSHOT of curated real data, not a live query of the
// pipeline. It is externalised here (rather than inlined in ledger.html)
// because the site externalises its page scripts to site/*.js; the service
// worker precaches this file for the offline shell.

const DATA = {
  timelines: {"M7TEE": [
      {"vintage":"2019-08-12","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"","created":""},
      {"vintage":"2020-03-26","rawToken":"M7TEE","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2021-01-29","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"","created":""},
      {"vintage":"2021-04-21","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"","created":""},
      {"vintage":"2022-03-07","rawToken":"M7TEE","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2022-03-14","rawToken":"M7TEE","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2023-01-25","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2022-10-26","created":""},
      {"vintage":"2023-08-18","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2022-10-26","created":""},
      {"vintage":"2023-11-24","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2022-10-26","created":""},
      {"vintage":"2023-12-07","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2022-10-26","created":""},
      {"vintage":"2024-01","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2022-10-26","created":""},
      {"vintage":"2024-04-30","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"","created":""},
      {"vintage":"2024-07","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2022-10-26","created":""},
      {"vintage":"2024-09","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"","created":"2018-10-18 07:06"},
      {"vintage":"2024-10-21","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2024-06-18","created":""},
      {"vintage":"2025-03-13","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2024-06-18","created":"2018-10-18"},
      {"vintage":"2025-09-11","rawToken":"M7TEE","status":"Allocated","classCanon":"Foundation","lastModified":"2024-06-18","created":""}
    ],"21CZS": [
      {"vintage":"2016-09","rawToken":"21CZS","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2016-09-20","rawToken":"21CZS","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2017-07-13","rawToken":"21CZS","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2019-08-12","rawToken":"21CZS","status":"Reserved","classCanon":"Intermediate","lastModified":"","created":""},
      {"vintage":"2021-01-29","rawToken":"21CZS","status":"Allocated","classCanon":"Intermediate","lastModified":"","created":""},
      {"vintage":"2021-04-21","rawToken":"21CZS","status":"Allocated","classCanon":"Intermediate","lastModified":"","created":""},
      {"vintage":"2022-03-07","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2022-03-14","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2023-01-25","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"2020-06-11","created":""},
      {"vintage":"2023-08-18","rawToken":"21CZS","status":"Allocated","classCanon":"Full","lastModified":"2020-06-11","created":""},
      {"vintage":"2024-01","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"2020-06-11","created":""},
      {"vintage":"2024-04-30","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2024-07","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"2024-05-26","created":""},
      {"vintage":"2024-09","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"","created":"2016-08-12 21:20"},
      {"vintage":"2024-10-21","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"2024-05-26","created":""},
      {"vintage":"2025-03-13","rawToken":"21CZS","status":"Allocated","classCanon":null,"lastModified":"2024-05-26","created":"2016-08-12"},
      {"vintage":"2025-09-11","rawToken":"21CZS","status":"Allocated","classCanon":"Full","lastModified":"2024-05-26","created":""}
    ],"G0TQK": [
      {"vintage":"2016-09","rawToken":"G0TQK","status":"Reserved","classCanon":"Full","lastModified":"","created":""},
      {"vintage":"2016-09-20","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2017-07-13","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2019-08-12","rawToken":"G0TQK","status":"Reserved","classCanon":"Full","lastModified":"","created":""},
      {"vintage":"2019-08-12","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":"Full","lastModified":"","created":""},
      {"vintage":"2020-03-26","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2020-10-23","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"2016-08-12","created":"2016-08-02"},
      {"vintage":"2021-01-29","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":"Full","lastModified":"","created":""},
      {"vintage":"2021-01-29","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2021-04-21","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":"Full","lastModified":"","created":""},
      {"vintage":"2021-04-21","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2022-03-07","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2022-03-07","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2022-03-14","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2022-03-14","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2023-01-25","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":"Full","lastModified":"2018-02-12","created":""},
      {"vintage":"2023-01-25","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"2016-08-12","created":""},
      {"vintage":"2023-08-18","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":"Full","lastModified":"2018-02-12","created":""},
      {"vintage":"2023-08-18","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"2016-08-12","created":""},
      {"vintage":"2024-01","rawToken":"G0TQK","status":"Allocated","classCanon":"Full","lastModified":"2018-02-12","created":""},
      {"vintage":"2024-01","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"2016-08-12","created":""},
      {"vintage":"2024-04-30","rawToken":"G0TQK","status":"Allocated","classCanon":"Full","lastModified":"","created":""},
      {"vintage":"2024-04-30","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""},
      {"vintage":"2024-07","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"2016-08-12","created":""},
      {"vintage":"2024-09","rawToken":"G0TQK","status":"Allocated","classCanon":"Full","lastModified":"","created":"2018-02-12 13:37"},
      {"vintage":"2024-09","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":"2016-08-02 17:46"},
      {"vintage":"2024-10-21","rawToken":"G0TQK","status":"Allocated","classCanon":"Full","lastModified":"2024-04-04","created":""},
      {"vintage":"2024-10-21","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"2016-08-12","created":""},
      {"vintage":"2025-03-13","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"2016-08-12","created":"2016-08-02"},
      {"vintage":"2025-09-11","rawToken":"G0TQK\u00a0","status":"Allocated","classCanon":"Full","lastModified":"2025-07-29","created":""},
      {"vintage":"2025-09-11","rawToken":"G0TQK","status":"Reserved","classCanon":null,"lastModified":"","created":""}]},
  anatomy: [
    {row:139149,raw:"G0TQK",bytes:"47 30 54 51 4b",status:"Reserved",type:"Call Sign - Amateur",rule:"identity"},
    {row:141818,raw:"G0TQK\u00a0",bytes:"47 30 54 51 4b a0",status:"Allocated",type:"Call Sign - Amateur",rule:"trim-edge-whitespace-incl-nbsp"}
  ],
  census: [
    {canon:"Full",count:911003}, {canon:"Foundation",count:501720}, {canon:"Intermediate",count:206435},
    {canon:"Club",count:26001}, {canon:"Special Event",count:3778}, {canon:"Reciprocal",count:1024},
    {canon:"Special Research Permit",count:1}
  ],
  spellings: {
    "Full": ["Amateur Full Radio Licence","Full"],
    "Foundation": ["Amateur Foundation Radio Licence","Foundation"],
    "Intermediate": ["Amateur Intermediate Radio Licence","Intermediate"],
    "Club": ["Amateur Club Radio Licence"],
    "Special Event": ["NoV Special Event Station","Special Event Station","NoV Special Special Event Station","Perm Special Event Station","NoV Permanent Special Event Station"],
    "Reciprocal": ["Amateur Temporary Reciprocal Radio Licence","Amateur Full (Reciprocal) Radio Licence"],
    "Special Research Permit": ["Special Research Permit"]
  },
  samples: {
    "Full": ["21CZS","2E1CZS","G0AAG","G0AAM","G0AAN","G0AAR"],
    "Foundation": ["21EXG","21FNR","21IEM","G1XPH","G6JRC","G6WHR"],
    "Intermediate": ["20AAA","20AAB","20AAC","20AAD","20AAE","20AAF"],
    "Club": ["G0AAA","G0ADD","G0ADX","G0AGR","G0ALE","G0ANT"]
  },
  cleaning: {
    rule: "toUpperCase(), then drop every character except A-Z 0-9 and /",
    distinctForms: 55, occurrences: 133,
    categories: [{cat:"punctuation",n:40},{cat:"case",n:26},{cat:"internal space",n:26},{cat:"RSL # slot",n:4},{cat:"trailing NBSP",n:3}],
    examples: [
      {raw:"g0jrk", cleaned:"G0JRK", cat:"case", note:"lower-case export"},
      {raw:"2e1GTD", cleaned:"2E1GTD", cat:"case", note:"mixed case"},
      {raw:"G6{SP}FMU", cleaned:"G6FMU", cat:"space", note:"stray space - collides with a genuine G6FMU; kept visible on purpose"},
      {raw:"G0TQK{NBSP}", cleaned:"G0TQK", cat:"NBSP", note:"latin-1 0xA0"},
      {raw:"M/EI-8-DJ", cleaned:"M/EI8DJ", cat:"punctuation", note:"hyphenated reciprocal"},
      {raw:"M/#PT2FM", cleaned:"M/PT2FM", cat:"RSL", note:"# is a slot marker, not damage"},
      {raw:"2020-08-20", cleaned:"20200820", cat:"Excel", note:"numeric callsign Excel stored as a date"}
    ]
  },
  regional: {
    core: "M7TEE", placeholder: "M#7TEE",
    renderings: [["ME7TEE","England"],["MW7TEE","Wales"],["MM7TEE","Scotland"],["MI7TEE","Northern Ireland"],["MD7TEE","Isle of Man"],["MJ7TEE","Jersey"],["MU7TEE","Guernsey"]]
  }
,
  dossier: [{"callsign":"M7TEE","category":"1. Baseline UK callsign — full anatomy","note":"M7 Foundation prefix, no RSL, suffix TEE. product=Foundation agrees with prefix-implied class: no mismatch. Clean parse.","reg":{"product":"Amateur Foundation Radio Licence","status":"Allocated","start":"2018-10-18","mod":"2025-10-11"},"parse":{"parseStatus":"parsed","prefixSeries":"M7","rsl":"","suffix":"TEE","placeholderForm":"M#7TEE","homeCallsign":"","impliedClass":"Foundation","flags":[]},"anatomy":{"prefix":{"series":"M7","level":"Foundation","issuing":"currently-issuing","layer":"derived"},"rsl":{"letter":"","region":null,"scope":null,"layer":"derived"},"suffix":{"value":"TEE","ever":false,"firstKnown":null,"churn":false,"disclosures":[{"v":"2016-09","present":false},{"v":"2019-08-12","present":false},{"v":"2019-09-12","present":false},{"v":"2024-12","present":false}],"layer":"derived"},"home":null},"flags":[],"crossSource":[]},{"callsign":"M/EI8DJ","category":"2. Reciprocal/visitor (M/ prefix) with clear foreign home callsign","note":"Temporary Reciprocal, Reserved. Home EI8DJ resolves to Ireland via ITU series EIA-EIZ. NOTE country is site-layer (proposed), not pipeline.","reg":{"product":"Amateur Temporary Reciprocal Radio Licence","status":"Reserved","start":"","mod":""},"parse":{"parseStatus":"visitor","prefixSeries":"","rsl":"","suffix":"","placeholderForm":"M#/EI8DJ","homeCallsign":"EI8DJ","impliedClass":"","flags":[]},"anatomy":{"prefix":null,"rsl":null,"suffix":null,"home":{"callsign":"EI8DJ","country":"Ireland","itu":"EIA - EIZ","layer":"proposed"}},"flags":[],"crossSource":[{"source":"archive/foi/ofcom-498906--reciprocal-licences-since-2010","note":"That FOI lists reciprocal-licence ISSUANCE EVENTS but as UK M0-format callsigns (M0GRT...), NOT M/home visitor strings — so it does not structurally link to M/EI8DJ.","layer":"proposed"}]},{"callsign":"M/#PT2FM","category":"2b. Reserved reciprocal with # RSL-placeholder after slash (hash-in-register)","note":"Home PT2FM -> Brazil. Demonstrates hash-in-register flag + site-layer hash-after-slash canonicalisation (M#/PT2FM).","reg":{"product":"Amateur Temporary Reciprocal Radio Licence","status":"Reserved","start":"","mod":""},"parse":{"parseStatus":"visitor","prefixSeries":"","rsl":"","suffix":"","placeholderForm":"M#/PT2FM","homeCallsign":"PT2FM","impliedClass":"","flags":["hash-in-register"]},"anatomy":{"prefix":null,"rsl":null,"suffix":null,"home":{"callsign":"PT2FM","country":"Brazil (Federative Republic of)","itu":"PTA - PTZ","layer":"proposed"}},"flags":[{"flag":"hash-in-register","gloss":"visitor row carrying a literal `#` immediately after the slash (`M/#PT2FM`).","layer":"derived"}],"crossSource":[]},{"callsign":"M5SHA","category":"3. class-product-mismatch (prefix-implied level != product)","note":"M5 prefix implies Full; product=Amateur Foundation Radio Licence -> class-product-mismatch fires. The documented FOI M5SHA case.","reg":{"product":"Amateur Foundation Radio Licence","status":"Allocated","start":"2021-01-28","mod":"2026-06-08"},"parse":{"parseStatus":"parsed","prefixSeries":"M5","rsl":"","suffix":"SHA","placeholderForm":"M#5SHA","homeCallsign":"","impliedClass":"Full","flags":["class-product-mismatch"]},"anatomy":{"prefix":{"series":"M5","level":"Full","issuing":"currently-issuing","layer":"derived"},"rsl":{"letter":"","region":null,"scope":null,"layer":"derived"},"suffix":{"value":"SHA","ever":false,"firstKnown":null,"churn":false,"disclosures":[{"v":"2016-09","present":false},{"v":"2019-08-12","present":false},{"v":"2019-09-12","present":false},{"v":"2024-12","present":false}],"layer":"derived"},"home":null},"flags":[{"flag":"class-product-mismatch","gloss":"licence class implied by the prefix series disagrees with the `product` column (both known).","layer":"derived"}],"crossSource":[{"source":"FOI 01667041 (Billy, \"Amateur Radio Licence Errors\", 2023-10-02) — docs/source-register.md","note":"Ofcom cites M5SHA as an example of class-product mismatch, stating \"we do not record it in this way\" — official confirmation the mismatch table is information Ofcom does not hold.","layer":"proposed"},{"source":"CAPABILITY ASSESSMENT","note":"M5SHA genuinely appears in FOI CORRESPONDENCE (01667041 disclosure-log PDF; 01403789 refusal) outside any register response body — a real cross-source case.","layer":"proposed"}]},{"callsign":"2E1HON","category":"4. BOTH forbidden-suffix AND forbidden-suffix-issued-after-first-known-list","note":"Suffix HON first-known-forbidden 2016-07-29; original start 2018-05-14 (a month strictly after) -> both flags. Register value carries a trailing space (whitespace flag) and explicit RSL E (rsl-in-register).","reg":{"product":"Amateur Intermediate Radio Licence","status":"Allocated","start":"2018-05-14","mod":"2025-10-11"},"parse":{"parseStatus":"parsed","prefixSeries":"21","rsl":"E","suffix":"HON","placeholderForm":"2#1HON","homeCallsign":"","impliedClass":"Intermediate","flags":["forbidden-suffix","forbidden-suffix-issued-after-first-known-list","rsl-in-register","whitespace"]},"anatomy":{"prefix":{"series":"21","level":"Intermediate","issuing":"formerly-issued","layer":"derived"},"rsl":{"letter":"E","region":"England","scope":"all","layer":"derived"},"suffix":{"value":"HON","ever":true,"firstKnown":"2016-07-29 17:19","churn":false,"disclosures":[{"v":"2016-09","present":true},{"v":"2019-08-12","present":true},{"v":"2019-09-12","present":true},{"v":"2024-12","present":true}],"layer":"derived"},"home":null},"flags":[{"flag":"forbidden-suffix","gloss":"suffix appears in the **ever-forbidden union** — every suffix on ANY forbidden-list disclosure the archive holds (2016 ∪ 2019 ∪ 2024 = **1,466**: the shared 1,465 plus `JIZ`), curated in `forbidden-su","layer":"derived"},{"flag":"forbidden-suffix-issued-after-first-known-list","gloss":"a `forbidden-suffix` row whose original start date falls in a month strictly after **that suffix's own first-known-forbidden month** — a candidate for scrutiny, not a verdict: it *appears* to post-dat","layer":"derived"},{"flag":"rsl-in-register","gloss":"parsed register value carries an explicit RSL — the register stores RSL-less core callsigns by design, so *presence* is the notable case (replaces the earlier `missing-rsl` flag, which marked ~19.5k b","layer":"derived"},{"flag":"whitespace","gloss":"value contains whitespace/invisible characters (removed before parsing)","layer":"derived"}],"crossSource":[]},{"callsign":"G1CFM","category":"4b. BOTH forbidden flags (clean example, no whitespace)","note":"Suffix CFM first-known-forbidden 2016-07-29; original start 2020-09-01 -> both flags. G1 Full agrees with product Full (no mismatch).","reg":{"product":"Amateur Full Radio Licence","status":"Allocated","start":"2020-09-01","mod":"2026-05-15"},"parse":{"parseStatus":"parsed","prefixSeries":"G1","rsl":"","suffix":"CFM","placeholderForm":"G#1CFM","homeCallsign":"","impliedClass":"Full","flags":["forbidden-suffix","forbidden-suffix-issued-after-first-known-list"]},"anatomy":{"prefix":{"series":"G1","level":"Full","issuing":"currently-issuing","layer":"derived"},"rsl":{"letter":"","region":null,"scope":null,"layer":"derived"},"suffix":{"value":"CFM","ever":true,"firstKnown":"2016-07-29 17:19","churn":false,"disclosures":[{"v":"2016-09","present":true},{"v":"2019-08-12","present":true},{"v":"2019-09-12","present":true},{"v":"2024-12","present":true}],"layer":"derived"},"home":null},"flags":[{"flag":"forbidden-suffix","gloss":"suffix appears in the **ever-forbidden union** — every suffix on ANY forbidden-list disclosure the archive holds (2016 ∪ 2019 ∪ 2024 = **1,466**: the shared 1,465 plus `JIZ`), curated in `forbidden-su","layer":"derived"},{"flag":"forbidden-suffix-issued-after-first-known-list","gloss":"a `forbidden-suffix` row whose original start date falls in a month strictly after **that suffix's own first-known-forbidden month** — a candidate for scrutiny, not a verdict: it *appears* to post-dat","layer":"derived"}],"crossSource":[]},{"callsign":"M7QNF","category":"5. Forbidden CHURN — QNF de-listed by 2024 (appearing/disappearing)","note":"QNF on 2016+2019 lists, ABSENT from 2024 export (working theory: artefact). Ever-forbidden union keeps it flagged. Original start 2025-02-07 (after first-known 2016-09) -> issued-after flag too.","reg":{"product":"Amateur Foundation Radio Licence","status":"Allocated","start":"2025-02-07","mod":"2025-10-11"},"parse":{"parseStatus":"parsed","prefixSeries":"M7","rsl":"","suffix":"QNF","placeholderForm":"M#7QNF","homeCallsign":"","impliedClass":"Foundation","flags":["forbidden-suffix","forbidden-suffix-issued-after-first-known-list"]},"anatomy":{"prefix":{"series":"M7","level":"Foundation","issuing":"currently-issuing","layer":"derived"},"rsl":{"letter":"","region":null,"scope":null,"layer":"derived"},"suffix":{"value":"QNF","ever":true,"firstKnown":"2016-09","churn":true,"disclosures":[{"v":"2016-09","present":true},{"v":"2019-08-12","present":true},{"v":"2019-09-12","present":true},{"v":"2024-12","present":false}],"layer":"derived"},"home":null},"flags":[{"flag":"forbidden-suffix","gloss":"suffix appears in the **ever-forbidden union** — every suffix on ANY forbidden-list disclosure the archive holds (2016 ∪ 2019 ∪ 2024 = **1,466**: the shared 1,465 plus `JIZ`), curated in `forbidden-su","layer":"derived"},{"flag":"forbidden-suffix-issued-after-first-known-list","gloss":"a `forbidden-suffix` row whose original start date falls in a month strictly after **that suffix's own first-known-forbidden month** — a candidate for scrutiny, not a verdict: it *appears* to post-dat","layer":"derived"}],"crossSource":[]},{"callsign":"G0JIZ","category":"5b. Forbidden CHURN — JIZ ADDED only in 2024 disclosure","note":"JIZ first appears in the 2024 disclosure, first-known 2020-12-10 (per-suffix LastModifiedDate). G0JIZ original start 1988-04-05 predates first-known -> forbidden-suffix but correctly NO issued-after flag.","reg":{"product":"Amateur Full Radio Licence","status":"Allocated","start":"1988-04-05","mod":"2025-10-11"},"parse":{"parseStatus":"parsed","prefixSeries":"G0","rsl":"","suffix":"JIZ","placeholderForm":"G#0JIZ","homeCallsign":"","impliedClass":"Full","flags":["forbidden-suffix"]},"anatomy":{"prefix":{"series":"G0","level":"Full","issuing":"currently-issuing","layer":"derived"},"rsl":{"letter":"","region":null,"scope":null,"layer":"derived"},"suffix":{"value":"JIZ","ever":true,"firstKnown":"2020-12-10 09:10","churn":true,"disclosures":[{"v":"2016-09","present":false},{"v":"2019-08-12","present":false},{"v":"2019-09-12","present":false},{"v":"2024-12","present":true}],"layer":"derived"},"home":null},"flags":[{"flag":"forbidden-suffix","gloss":"suffix appears in the **ever-forbidden union** — every suffix on ANY forbidden-list disclosure the archive holds (2016 ∪ 2019 ∪ 2024 = **1,466**: the shared 1,465 plus `JIZ`), curated in `forbidden-su","layer":"derived"}],"crossSource":[]}]
};
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const isActive = s => s === "Allocated";
const showRaw = t => t.replace(/\u00a0/g, "[NBSP]").replace(/ /g, "[SP]");
const showNbsp = s => s.replace(/\u00a0/g, "[NBSP]");

function fold(cs) {
  // Track a stream PER RAW VARIANT (never collapsed to the entity), so which raw
  // token carried each change stays visible. Within a variant, classify changes
  // by tier: licence-state (status/class) is primary; a timestamp-only move
  // (last-modified) is a DE-EMPHASISED admin update, not a licence event.
  const obs = DATA.timelines[cs].map((o, i) => ({ ...o, i }))
    .sort((a, b) => a.vintage < b.vintage ? -1 : a.vintage > b.vintage ? 1 : a.i - b.i);
  const state = new Map(); // rawToken -> { status, klass, stamp }
  const byV = new Map();
  let births = 0, changes = 0, admin = 0;
  for (const o of obs) {
    const st = state.get(o.rawToken) ?? {};
    const evs = [];
    if (o.status && o.status !== st.status) {
      const birth = st.status === undefined;
      evs.push({ cls: birth ? "birth" : "change", t: "status → " + o.status });
      birth ? births++ : changes++; st.status = o.status;
    }
    if (o.classCanon && o.classCanon !== st.klass) {
      const birth = st.klass === undefined;
      evs.push({ cls: birth ? "birth" : "change", t: "class → " + o.classCanon });
      birth ? births++ : changes++; st.klass = o.classCanon;
    }
    const stamp = (o.lastModified || "") + "|" + (o.created || "");
    const hasStamp = !!(o.lastModified || o.created);
    if (hasStamp && st.stamp !== undefined && stamp !== st.stamp && !evs.length) {
      evs.push({ cls: "admin", t: "admin update" + (o.lastModified ? " · modified " + o.lastModified : "") });
      admin++;
    }
    if (hasStamp || st.stamp === undefined) st.stamp = stamp;
    state.set(o.rawToken, st);
    if (!evs.length) evs.push({ cls: "cont", t: "unchanged" });
    if (!byV.has(o.vintage)) byV.set(o.vintage, []);
    byV.get(o.vintage).push({ variant: o.rawToken !== cs ? o.rawToken : null, status: o.status, active: isActive(o.status), evs });
  }
  const vints = [...byV.keys()].sort();
  for (const v of vints) { const list = byV.get(v); const multi = list.length > 1;
    for (const ob of list) ob.role = !multi ? "solo" : (ob.active ? "active" : "parallel"); }
  return { byV, vints, births, changes, admin, snaps: obs.length, variants: new Set(obs.map(o => o.rawToken)) };
}

function renderEntity(cs) {
  const host = document.getElementById("entity"); host.innerHTML = "";
  const f = fold(cs);
  const card = el("div", "entity");
  const head = el("div", "entity-head");
  head.appendChild(el("div", "id", cs));
  const s1 = el("div", "stat");
  s1.innerHTML = `<b>${f.snaps}</b> observations · <b>${f.vints.length}</b> vintages` +
    (f.variants.size > 1 ? ` · <b>${f.variants.size}</b> raw variants` : "") +
    (f.admin ? ` · <b>${f.admin}</b> admin updates` : "");
  head.appendChild(s1);
  const verdict = el("div", "verdict " + (f.changes ? "moved" : "flat"),
    f.changes ? `${f.changes} real change${f.changes>1?"s":""}` : "no real change");
  head.appendChild(verdict);
  card.appendChild(head);

  const tl = el("div", "tl");
  for (const v of f.vints) {
    const list = f.byV.get(v);
    list.forEach((ob, idx) => {
      const row = el("div", "tl-row" + (ob.role === "parallel" ? " parallel" : ""));
      row.appendChild(el("div", "vint", idx === 0 ? v : ""));
      const body = el("div", "body");
      if (ob.variant) { const vt = el("span", "variant-tag"); vt.textContent = "raw variant " + showRaw(ob.variant); body.appendChild(vt); }
      if (ob.role === "parallel") body.appendChild(el("span", "ev split-inactive", ob.status + " · parallel"));
      for (const e of ob.evs) body.appendChild(el("span", "ev " + e.cls, e.t));
      row.appendChild(body); tl.appendChild(row);
    });
  }
  card.appendChild(tl);
  host.appendChild(card);

  const note = el("p", "obs-mini");
  note.style.margin = "12px 4px 0";
  if (cs === "M7TEE") note.textContent = "Foundation and Allocated throughout — zero licence-state changes. The movement you can see (the last-modified date advancing, the class spelling flipping between “Foundation” and “Amateur Foundation Radio Licence”) is admin and vocabulary noise, shown de-emphasised, never counted as a real change.";
  else if (cs === "21CZS") note.textContent = "A genuine story: reserved for years, activated in 2021, then upgraded Intermediate → Full. The blank classes in between are unobserved, not downgrades.";
  else note.textContent = "Several vintages carry two observations at once — a clean token and its NBSP variant — tracked as SEPARATE streams so you can see which raw form each belongs to. The active (Allocated) stream leads; the inactive Reserved parallel is de-emphasised. A de-emphasised parallel carrying a damaged token usually reflects a rectification in progress, not a real second status.";
  host.appendChild(note);
}

document.getElementById("resolver").addEventListener("click", e => {
  const b = e.target.closest("button.chip"); if (!b) return;
  for (const x of document.querySelectorAll("#resolver .chip")) x.setAttribute("aria-pressed", x === b);
  renderEntity(b.dataset.cs);
});

// ---- Layer anatomy -----------------------------------------------------------
function renderAnatomy() {
  const host = document.getElementById("anatomy");
  for (const o of DATA.anatomy) {
    const damaged = o.rule !== "identity";
    const box = el("div", "obs");
    const top = el("div"); top.style.display = "flex"; top.style.justifyContent = "space-between"; top.style.alignItems = "center";
    top.appendChild(el("span", "badge raw", "raw · row " + o.row));
    top.appendChild(el("span", "obs-mini", damaged ? "trailing NBSP" : "clean"));
    box.appendChild(top);
    const kv = el("div", "kv");
    const rawVal = damaged ? `G0TQK<span class="nbsp">␠</span>` : "G0TQK";
    kv.innerHTML = `<span class="k">Value</span><span class="v">${rawVal}</span>
      <span class="k">bytes</span><span class="v"><span class="bytes">${o.bytes}</span></span>
      <span class="k">Status</span><span class="v">${o.status}</span>
      <span class="k">Type</span><span class="v">${o.type}</span>`;
    box.appendChild(kv);
    const edge = el("div", "edge");
    edge.innerHTML = `<span class="badge derived">derived</span> &nbsp;“${showNbsp(o.raw)}” <span class="rel">normalises_to</span> G0TQK<br>
      <span style="color:var(--muted)">rule:</span> ${o.rule}`;
    box.appendChild(edge);
    host.appendChild(box);
  }
}

// ---- Vocabulary query --------------------------------------------------------
function renderCensus() {
  const tb = document.querySelector("#census tbody");
  for (const r of DATA.census) {
    const tr = el("tr"); tr.dataset.canon = r.canon; tr.tabIndex = 0; tr.style.cursor = "pointer";
    tr.innerHTML = `<td><span class="cn">${r.canon}</span></td><td class="n">${r.count.toLocaleString()}</td>`;
    tr.addEventListener("click", () => selectClass(r.canon));
    tr.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectClass(r.canon); } });
    tb.appendChild(tr);
  }
}
function selectClass(canon) {
  for (const tr of document.querySelectorAll("#census tbody tr")) tr.classList.toggle("sel", tr.dataset.canon === canon);
  const host = document.getElementById("spellings"); host.innerHTML = "";
  const raws = DATA.spellings[canon] || [];
  const lab = el("div", "lab"); lab.innerHTML = `<b>${raws.length}</b> raw spelling${raws.length>1?"s":""} unify to one canonical type:`;
  host.appendChild(lab);
  const line = el("div", "raws");
  raws.forEach((r, i) => { line.appendChild(el("span", "rawpill", r)); });
  line.appendChild(el("span", "arrow-to", "→"));
  line.appendChild(el("span", "canonpill", canon));
  host.appendChild(line);
  const s = DATA.samples[canon];
  if (s) { const sm = el("div", "samples"); sm.innerHTML = `<b>${canon}</b> in the latest snapshot includes: ` + s.join("  ·  "); host.appendChild(sm); }
  else if (canon === "Special Research Permit") { const sm = el("div", "samples"); sm.textContent = "A single observation in the entire archive — the rarest type on record."; host.appendChild(sm); }
}

// ---- Normalisation: cleaning + regional --------------------------------------
const showMarks = str => str.replace(/{NBSP}/g, '<span class="nbsp">␣ᴺᴮ</span>').replace(/{SP}/g, '<span class="nbsp">␣</span>');
function renderCleaning() {
  const c = DATA.cleaning;
  document.getElementById("clean-rule").textContent = c.rule;
  document.getElementById("clean-forms").textContent = c.distinctForms;
  document.getElementById("clean-occ").textContent = c.occurrences;
  const cats = document.getElementById("clean-cats");
  for (const k of c.categories) { const chip = el("span", "rawpill");
    chip.style.background = "var(--surface-2)"; chip.style.color = "var(--muted)";
    chip.innerHTML = k.cat + ' <b style="color:var(--ink)">' + k.n + '</b>'; cats.appendChild(chip); }
  const tb = document.querySelector("#cleaning tbody");
  for (const e of c.examples) {
    const tr = el("tr");
    const isRsl = e.cat === "RSL";
    tr.innerHTML = '<td>' + showMarks(e.raw) + '</td><td style="color:var(--steady)">' + e.cleaned + '</td>' +
      '<td style="color:' + (isRsl ? 'var(--signal)' : 'var(--muted)') + '">' + e.cat + '</td>' +
      '<td style="white-space:normal; color:var(--muted); font-family:var(--sans); font-size:12.5px">' + e.note + '</td>';
    tb.appendChild(tr);
  }
}
function renderRegional() {
  const r = DATA.regional;
  document.getElementById("reg-core").textContent = r.core;
  document.getElementById("reg-key").textContent = r.placeholder;
  const host = document.getElementById("regional");
  const core = el("span", "rawpill"); core.style.background = "var(--signal-soft)"; core.style.color = "var(--signal)";
  core.innerHTML = r.core + ' <span style="opacity:.7">core</span>'; host.appendChild(core);
  for (const [rend, region] of r.renderings) {
    const pill = el("span", "rawpill");
    pill.innerHTML = rend + ' <span style="opacity:.7">' + region + '</span>';
    host.appendChild(pill);
  }
}


function renderDossier(cs) {
  const d = DATA.dossier.find(x => x.callsign === cs);
  const host = document.getElementById("dossier"); host.innerHTML = "";
  if (!d) return;
  const card = el("div", "entity");
  const head = el("div", "entity-head");
  head.appendChild(el("div", "id", d.callsign));
  const st = el("div", "stat");
  st.innerHTML = "<b>" + d.reg.status + "</b> · " + d.reg.product + (d.reg.start ? " · issued " + d.reg.start : "");
  head.appendChild(st);
  card.appendChild(head);
  const body = el("div"); body.style.padding = "16px 18px";
  const note = el("p", "obs-mini"); note.style.margin = "0 0 6px"; note.textContent = d.category; body.appendChild(note);

  const badge = layer => { const b = el("span", "tb " + (layer === "derived" ? "d" : "p")); b.textContent = layer; return b; };
  const section = (title) => { const s = el("div", "dsec"); s.appendChild(el("h4", null, title)); return s; };
  const row = (lab, valNode, layer) => { const r = el("div", "drow");
    r.appendChild(el("span", "lab", lab)); const v = el("span", "val");
    if (typeof valNode === "string") v.innerHTML = valNode; else v.appendChild(valNode);
    r.appendChild(v); if (layer) r.appendChild(badge(layer)); return r; };

  const a = d.anatomy;
  const anat = section("anatomy of the parts");
  if (a.prefix) anat.appendChild(row("prefix", "<b>" + a.prefix.series + "</b> — " + a.prefix.level + " licence level (" + a.prefix.issuing + ")", a.prefix.layer));
  if (a.rsl && a.rsl.letter) anat.appendChild(row("RSL", "<b>" + a.rsl.letter + "</b> → " + a.rsl.region + " (" + a.rsl.scope + ")", a.rsl.layer));
  else if (a.rsl) anat.appendChild(row("RSL", "none — register stores the RSL-less core by design", a.rsl.layer));
  if (a.home) anat.appendChild(row("home", "<b>" + a.home.callsign + "</b> → " + a.home.country + " <span style='color:var(--faint)'>(ITU " + a.home.itu + ")</span>", a.home.layer));
  if (a.suffix) {
    const churn = el("span", "churn");
    for (const p of a.suffix.disclosures) { const c = el("span", "cdot " + (p.present ? "on" : "off")); c.textContent = p.v + (p.present ? " on" : " off"); churn.appendChild(c); }
    const wrap = el("span");
    wrap.innerHTML = "<b>" + a.suffix.value + "</b> — " + (a.suffix.ever ? "on the ever-forbidden union" + (a.suffix.firstKnown ? " (first known " + a.suffix.firstKnown + ")" : "") : "never forbidden") + (a.suffix.churn ? " · <span style='color:var(--change)'>churn</span>" : "") + "<br>";
    wrap.appendChild(churn);
    anat.appendChild(row("suffix", wrap, a.suffix.layer));
  }
  body.appendChild(anat);

  if (d.flags.length) {
    const fs2 = section("notable observations");
    for (const f of d.flags) { const fc = el("div", "flagcard");
      const top = el("div"); top.style.display = "flex"; top.style.justifyContent = "space-between"; top.style.gap = "8px";
      top.appendChild(el("span", "fn", f.flag)); top.appendChild(badge(f.layer)); fc.appendChild(top);
      fc.appendChild(el("div", "fg", f.gloss)); fs2.appendChild(fc); }
    body.appendChild(fs2);
  } else {
    const s = section("notable observations"); s.appendChild(el("p", "obs-mini", "None — a clean, unremarkable record.")); body.appendChild(s);
  }

  if (d.crossSource.length) {
    const cs2 = section("cross-referenced from other sources");
    for (const c of d.crossSource) { const fc = el("div", "flagcard");
      const top = el("div"); top.style.display = "flex"; top.style.justifyContent = "space-between"; top.style.gap = "8px";
      top.appendChild(el("span", "fn", c.source)); top.appendChild(badge(c.layer)); fc.appendChild(top);
      fc.appendChild(el("div", "fg", c.note)); cs2.appendChild(fc); }
    body.appendChild(cs2);
  }
  card.appendChild(body); host.appendChild(card);
}
(function initDossier() {
  const chips = document.getElementById("dossier-chips");
  DATA.dossier.forEach((d, i) => { const b = el("button", "chip"); b.textContent = d.callsign;
    b.setAttribute("aria-pressed", i === 0 ? "true" : "false"); b.dataset.cs = d.callsign; chips.appendChild(b); });
  chips.addEventListener("click", e => { const b = e.target.closest("button.chip"); if (!b) return;
    for (const x of chips.querySelectorAll(".chip")) x.setAttribute("aria-pressed", x === b);
    renderDossier(b.dataset.cs); });
  renderDossier(DATA.dossier[0].callsign);
})();

renderEntity("M7TEE");
renderAnatomy();
renderCensus();
selectClass("Full");
renderCleaning();
renderRegional();
