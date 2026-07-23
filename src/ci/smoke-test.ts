/**
 * Post-deploy smoke test (issue #497): light liveness + integrity checks against
 * the LIVE Pages deployment, run after actions/deploy-pages in cicd.yaml. It is
 * deliberately NOT a functional test - it confirms the deploy SUCCEEDED and
 * shipped the right, correctly PACKAGED bytes, which are the publish concerns the
 * per-PR suite does not cover since the tier verification moved to a raw build
 * (#478/#496). It reports EVERY failing check, then exits non-zero if any failed,
 * so one run surfaces the whole picture rather than the first fault only.
 *
 * Usage: node src/ci/smoke-test.ts <base-url>   (GITHUB_SHA read from env)
 *   base-url is the deploy job's page_url, e.g.
 *   https://mysteraitch.github.io/amateur-callsigns-file-watch/
 */

const GZIP_MAGIC = [0x1f, 0x8b] as const;
// A just-live deploy can 404 at a CDN edge for a few seconds. We first poll the
// home page until it is live (propagation), then give each individual check only
// a couple of quick retries - once the site is confirmed live, a 404 is a real
// fault, not propagation, and should not cost a long wait.
const LIVE_ATTEMPTS = 12;
const LIVE_DELAY_MS = 10_000;
const CHECK_ATTEMPTS = 3;
const CHECK_DELAY_MS = 3_000;

const base = process.argv[2];
if (base === undefined || base.trim() === '') {
  console.error('smoke-test: base URL required as the first argument');
  process.exit(2);
}
const baseUrl = base.endsWith('/') ? base : `${base}/`;
const expectedSha = process.env.GITHUB_SHA ?? '';

const failures: string[] = [];
const fail = (check: string, detail: string): void => { failures.push(`${check}: ${detail}`); console.error(`  FAIL ${check} - ${detail}`); };
const pass = (check: string, detail = ''): void => { console.log(`  ok   ${check}${detail !== '' ? ` - ${detail}` : ''}`); };

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const abs = (pathRel: string): string => new URL(pathRel, baseUrl).toString();

// Fetch with bounded retries. A response with status < 500 (and not 404) is
// returned immediately; 404/5xx/network errors are retried, since those are the
// shapes CDN propagation and transient edge faults take.
async function fetchRetry(pathRel: string, init: RequestInit, attempts: number, delayMs: number): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(abs(pathRel), init);
      if (res.status < 500 && res.status !== 404) return res;
      last = res;
    } catch {
      last = undefined;
    }
    if (attempt < attempts) await delay(delayMs);
  }
  if (last !== undefined) return last;
  throw new Error(`no response after ${attempts} attempts`);
}

// Identity encoding keeps Pages from negotiating a gzip variant: for large
// objects that variant is a slow CDN miss (issue #475), and for the compression
// checks we want the stored byte size, not a re-compressed one.
const IDENTITY = { 'Accept-Encoding': 'identity' } as const;

async function waitForLive(): Promise<void> {
  for (let attempt = 1; attempt <= LIVE_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(abs(''), { method: 'GET', headers: { ...IDENTITY } });
      if (res.status === 200) { pass('home page live', `after ${attempt} attempt(s)`); return; }
    } catch {
      // fall through to retry
    }
    if (attempt < LIVE_ATTEMPTS) await delay(LIVE_DELAY_MS);
  }
  fail('home page live', `still not 200 after ${LIVE_ATTEMPTS} attempts`);
}

async function expectOk(pathRel: string, label = pathRel): Promise<void> {
  try {
    const res = await fetchRetry(pathRel, { method: 'GET', headers: { ...IDENTITY } }, CHECK_ATTEMPTS, CHECK_DELAY_MS);
    if (res.status === 200) pass(`GET ${label}`, '200');
    else fail(`GET ${label}`, `status ${res.status}`);
  } catch (e) {
    fail(`GET ${label}`, String(e));
  }
}

// A page must load 200 and its body must carry every `include` marker and none
// of the `exclude` markers - the content check that tells a served v1 page
// apart from the redirect stub that used to own the same URL (issue #921).
async function expectPageContent(
  pathRel: string,
  markers: { include?: string[]; exclude?: string[] },
  label = pathRel,
): Promise<void> {
  try {
    const res = await fetchRetry(pathRel, { method: 'GET', headers: { ...IDENTITY } }, CHECK_ATTEMPTS, CHECK_DELAY_MS);
    if (res.status !== 200) { fail(`GET ${label}`, `status ${res.status}`); return; }
    const html = await res.text();
    for (const needle of markers.include ?? []) {
      if (!html.includes(needle)) { fail(`content ${label}`, `expected body to contain "${needle}"`); return; }
    }
    for (const needle of markers.exclude ?? []) {
      if (html.includes(needle)) { fail(`content ${label}`, `expected body NOT to contain "${needle}"`); return; }
    }
    pass(`GET ${label}`, '200 + content');
  } catch (e) {
    fail(`GET ${label}`, String(e));
  }
}

// An address the v1 surface does not serve must return the honest static 404:
// HTTP 404 (so programmatic clients see the miss) with the honest page body (so
// a human is told the record is migrating and offered the pages that exist).
async function expectHonest404(pathRel: string, mustInclude: string, label = pathRel): Promise<void> {
  try {
    let res: Response | undefined;
    for (let attempt = 1; attempt <= CHECK_ATTEMPTS; attempt += 1) {
      res = await fetch(abs(pathRel), { method: 'GET', headers: { ...IDENTITY } });
      if (res.status === 404) break;
      if (attempt < CHECK_ATTEMPTS) await delay(CHECK_DELAY_MS);
    }
    if (res === undefined) { fail(`404 ${label}`, 'no response'); return; }
    if (res.status !== 404) { fail(`404 ${label}`, `expected 404, got ${res.status}`); return; }
    const html = await res.text();
    if (html.includes(mustInclude)) pass(`404 ${label}`, '404 + honest page');
    else fail(`404 ${label}`, `honest-404 body missing "${mustInclude}"`);
  } catch (e) {
    fail(`404 ${label}`, String(e));
  }
}

// A 0-0 Range returns 206 with the full size in Content-Range (bytes 0-0/TOTAL),
// so a large file's reachability and size are checked without downloading it.
async function rangeTotal(pathRel: string): Promise<number | undefined> {
  try {
    const res = await fetchRetry(pathRel, { method: 'GET', headers: { ...IDENTITY, Range: 'bytes=0-0' } }, CHECK_ATTEMPTS, CHECK_DELAY_MS);
    if (res.status !== 206) { fail(`range ${pathRel}`, `expected 206, got ${res.status}`); return undefined; }
    const contentRange = res.headers.get('content-range') ?? '';
    const match = contentRange.match(/\/(\d+)\s*$/);
    if (match === null) { fail(`range ${pathRel}`, `no total in Content-Range "${contentRange}"`); return undefined; }
    return Number(match[1]);
  } catch (e) {
    fail(`range ${pathRel}`, String(e));
    return undefined;
  }
}

async function firstBytes(pathRel: string, n: number): Promise<Uint8Array | undefined> {
  try {
    const res = await fetchRetry(pathRel, { method: 'GET', headers: { ...IDENTITY, Range: `bytes=0-${n - 1}` } }, CHECK_ATTEMPTS, CHECK_DELAY_MS);
    if (res.status !== 206 && res.status !== 200) { fail(`bytes ${pathRel}`, `status ${res.status}`); return undefined; }
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    fail(`bytes ${pathRel}`, String(e));
    return undefined;
  }
}

// Confirm a .gz artefact is genuinely compressed, catching an uncompressed file
// shipped under a .gz name two ways: the gzip magic bytes must be present (a raw
// CSV/SQLite would fail this), and, where a ceiling is given, the stored size
// must be well under what the uncompressed data would be (a level-0/stored file
// would fail this).
async function expectGzip(pathRel: string, maxBytes?: number): Promise<void> {
  const head = await firstBytes(pathRel, 2);
  if (head !== undefined) {
    if (head.length >= 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1]) pass(`gzip-magic ${pathRel}`);
    else fail(`gzip-magic ${pathRel}`, `first bytes [${[...head].map(b => b.toString(16).padStart(2, '0')).join(' ')}] are not gzip - uncompressed shipped?`);
  }
  if (maxBytes !== undefined) {
    const total = await rangeTotal(pathRel);
    if (total !== undefined) {
      if (total < maxBytes) pass(`gzip-size ${pathRel}`, `${total} bytes`);
      else fail(`gzip-size ${pathRel}`, `${total} bytes >= ${maxBytes} ceiling - looks uncompressed`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`smoke-test against ${baseUrl}`);
  await waitForLive();

  // 1. Liveness: home + the key hand-authored pages.
  for (const p of ['index.html', 'statistics.html', 'explore.html', 'compare.html', 'ledger.html', 'callsign.html', 'data-status.html', 'glossary.html', 'about.html']) {
    await expectOk(p);
  }

  // 2. Assets: scripts, styles, the service worker, the manifest, the vendored
  //    query engine, and the small data manifests (including the callsign
  //    page's shard manifest, #594).
  for (const p of ['app.js', 'style.css', 'tokens.css', 'sw.js', 'manifest.webmanifest', 'vendor/sql-wasm.wasm', 'vendor/sqlite.worker.js', 'data/version.txt', 'data/claim-ledger.chunks.json', 'callsign/data/datasets.json']) {
    await expectOk(p);
  }

  // 3. The range-served runtime databases the interactive surfaces query - the
  //    ledger-derived projection pair (issue #572) - are reachable and non-empty.
  for (const db of ['data/ledger-lookup.sqlite.png', 'data/ledger-history.sqlite.png']) {
    const dbTotal = await rangeTotal(db);
    if (dbTotal !== undefined) {
      if (dbTotal > 0) pass(`range ${db}`, `${dbTotal} bytes`);
      else fail(`range ${db}`, 'zero length');
    }
  }

  // 4. Version stamp: version.txt equals the deployed commit and the footer
  //    carries the short SHA, so we can tell the deploy actually superseded the
  //    previous one rather than serving a stale build.
  try {
    const res = await fetchRetry('data/version.txt', { method: 'GET', headers: { ...IDENTITY } }, CHECK_ATTEMPTS, CHECK_DELAY_MS);
    const body = (await res.text()).trim();
    if (expectedSha === '') pass('version.txt', `no GITHUB_SHA to compare against; served ${body}`);
    else if (body === expectedSha) pass('version.txt', 'matches GITHUB_SHA');
    else fail('version.txt', `"${body}" does not match GITHUB_SHA "${expectedSha}"`);
  } catch (e) {
    fail('version.txt', String(e));
  }
  if (expectedSha !== '') {
    // The generated pages carry the SHA-stamped footer (site-render.ts's
    // footerHtml: "commit <code>{9-char SHA}</code>"); the hand-authored pages
    // (index, about, glossary) do not, so the footer check targets a generated
    // page. BUILD_SHA is the first 9 characters of the commit SHA.
    const shortSha = expectedSha.slice(0, 9);
    try {
      const res = await fetchRetry('statistics.html', { method: 'GET', headers: { ...IDENTITY } }, CHECK_ATTEMPTS, CHECK_DELAY_MS);
      const html = await res.text();
      if (html.includes(`<code>${shortSha}</code>`)) pass('footer-sha', `statistics.html footer carries ${shortSha}`);
      else fail('footer-sha', `statistics.html footer does not contain the short SHA ${shortSha}`);
    } catch (e) {
      fail('footer-sha', String(e));
    }
  }

  // 5. Compression sanity - the gzipped DOWNLOAD artefacts must actually be
  //    compressed. The combined runtime .png was retired (issue #445); its
  //    download twin (combined.sqlite.gz) still ships, so its gzip magic and
  //    size ceiling stand in for the old twin-vs-raw comparison.
  await expectGzip('data/foi-observations.csv.gz', 100 * 1024 * 1024); // raw union CSV is ~0.6 GB; compressed is tens of MB.
  await expectGzip('data/datasets/foi--ofcom-498906--reciprocal-licences-since-2010.sqlite.gz');
  await expectGzip('data/combined.sqlite.gz', 1024 * 1024 * 1024); // the raw combined is ~1.1 GB; its gzip twin is well under a GB.

  // 6. The v1 front door (issue #921). baseUrl is the /v0/ subtree, so the site
  //    root is one level up. The v1 pages must serve the real v1 shell at the
  //    root, and an old pre-move URL that is not part of the v1 surface must
  //    serve the honest static 404 (not a redirect, not a broken link).
  await expectPageContent('../', { include: ['callsign-record', 'Look up'] }, 'root / (v1 home)');
  await expectPageContent('../callsign.html', { include: ['Look up a callsign'] }, 'root /callsign.html (v1)');
  await expectPageContent('../on-this-day.html', { include: ['callsign-record', 'On this day'] }, 'root /on-this-day.html (v1)');
  await expectPageContent('../timeline.html', { include: ['callsign-record', 'Timeline'] }, 'root /timeline.html (v1)');
  await expectPageContent('../how-to-get-the-raw-data.html', { include: ['get the raw data'] }, 'root /how-to-get-the-raw-data.html (v1)');
  await expectPageContent('../glossary.html', { include: ['callsign-record', 'reading the record'] }, 'root /glossary.html (v1)');
  await expectPageContent('../anatomy.html', { include: ['callsign-record', 'The parts of a UK amateur callsign'] }, 'root /anatomy.html (v1)');
  // The root-served history manifests the two pages fetch (issue #932).
  await expectOk('../on-this-day.json', 'root /on-this-day.json (v1 history data)');
  await expectOk('../timeline.json', 'root /timeline.json (v1 history data)');
  await expectHonest404('../statistics.html', 'isn’t part of the site', 'root /statistics.html (honest 404)');

  console.log('');
  if (failures.length > 0) {
    console.error(`smoke-test FAILED: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log(`smoke-test passed (${baseUrl})`);
  // Exit explicitly on success, as the failure paths above already do. Node's
  // global fetch (undici) keeps its connection pool's sockets alive after the
  // last request, and those open handles keep the event loop - and so the
  // process, and the CI job - running until they idle out many minutes later.
  // The checks are complete here, so terminate rather than linger on keep-alive.
  process.exit(0);
}

if (import.meta.main) {
  void main();
}
