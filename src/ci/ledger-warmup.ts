/**
 * CDN warm-up for the claim-ledger post-deploy check (issue #537).
 *
 * Every cache-busting deploy serves a COLD 1.44 GB chunked ledger. The first
 * in-browser open (sql.js-httpvfs, chunked serverMode) range-reads the SQLite
 * header and the leading btree pages, each a cold Fastly MISS -> origin fetch, so
 * the cold open can exceed the functionality check's settle budget - a
 * FALSE-ALARM CI failure that is really the #475 cold-open latency, not a broken
 * database (the served chunks are well-formed both cold and warm).
 *
 * The fix is to PRIME the CDN edge for the bytes the browser reads first, before
 * the timed settle assertion, so the assertion measures a WARM open (what a
 * returning user experiences) rather than the one-off cold deploy. The serving
 * layout (see site/ledger-query.js and .github/workflows/cicd.yaml) is:
 *   - the database is split into fixed-size chunk files named
 *     data/claim-ledger.sqlite.png.000, .001, ... (serverChunkSize each);
 *   - a manifest data/claim-ledger.chunks.json declares databaseLengthBytes,
 *     serverChunkSize and the numeric-suffix width;
 *   - the browser range-reads WITHIN those chunk files, busting the CDN per
 *     deploy with a ?cb=<version> query (version from data/version.txt).
 * A cold open's first reads are the SQLite header and schema/btree root pages,
 * which live at the START of the first chunk file(s). Priming a leading range of
 * the first chunk or two pulls those objects to the CDN edge (GitHub Pages/Fastly
 * caches the whole object on a cacheable range miss), so the browser's subsequent
 * range reads within them are warm hits. The priming URL matches the browser's
 * exactly - same path and same ?cb=<version> cache key - or it would warm the
 * wrong cache object and prime nothing useful.
 *
 * The warm-up is BOUNDED and BEST-EFFORT: a fixed few small reads, each with its
 * own timeout, and any failure is logged and skipped - it must never abort or
 * hang the job. The check's real settle timeout is retained as the safety net, so
 * a genuine hang still fails.
 */

// The chunk-file base name the deploy writes and the ledger page reads (see
// LEDGER_DB_FILE in site/ledger-query.js). The chunk files append a zero-padded
// numeric suffix to this, e.g. claim-ledger.sqlite.png.000. The .png costume
// keeps GitHub Pages from gzip-transcoding the SQLite bytes (issue #475).
const LEDGER_CHUNK_BASE = 'claim-ledger.sqlite.png';
const LEDGER_MANIFEST_PATH = 'data/claim-ledger.chunks.json';
const LEDGER_VERSION_PATH = 'data/version.txt';

// The browser opens the ledger with requestChunkSize 4096 (site/ledger-query.js),
// so a 4 KiB read is exactly the first btree-page granularity a cold open hits.
const REQUEST_CHUNK_SIZE = 4096;
// Prime the leading chunk or two: the first holds the SQLite header, schema root
// and first btree pages; the second covers a small overspill. Bounded on purpose.
const MAX_PRIMED_CHUNKS = 2;
// Per-read timeout so a slow warm-up read cannot hang the job; the retained
// settle assertion, not the warm-up, is where a genuine hang must surface.
const WARMUP_READ_TIMEOUT_MS = 30_000;
// The manifest and version reads are small; keep them briskly bounded too.
const WARMUP_META_TIMEOUT_MS = 15_000;

export interface LedgerChunkManifest {
  databaseLengthBytes: number;
  serverChunkSize: number;
  suffixLength: number;
}

export interface WarmupTarget {
  url: string;
  rangeHeader: string;
}

// Pure: the chunk range reads that prime the CDN edge for a cold open's first
// bytes. Given the served manifest, the chunk-file URL prefix (ending in the
// trailing dot before the numeric suffix), the deploy cache-bust version and the
// browser's requestChunkSize, return up to `maxChunks` leading-chunk range reads.
// Each range starts at byte 0 - the header and btree root of the whole database
// sit at the very start of the first chunk - and is clamped to the chunk's own
// length so a tiny build's short final chunk is not over-read. A non-positive or
// malformed manifest yields no targets (nothing sensible to prime).
export function ledgerWarmupTargets(
  manifest: LedgerChunkManifest,
  urlPrefix: string,
  version: string,
  options: { maxChunks: number; requestChunkSize: number },
): WarmupTarget[] {
  const { databaseLengthBytes, serverChunkSize, suffixLength } = manifest;
  const { maxChunks, requestChunkSize } = options;
  if (
    !Number.isFinite(databaseLengthBytes) || databaseLengthBytes <= 0 ||
    !Number.isFinite(serverChunkSize) || serverChunkSize <= 0 ||
    !Number.isFinite(requestChunkSize) || requestChunkSize <= 0 ||
    maxChunks <= 0
  ) {
    return [];
  }
  const totalChunks = Math.ceil(databaseLengthBytes / serverChunkSize);
  const count = Math.min(maxChunks, totalChunks);
  const targets: WarmupTarget[] = [];
  for (let i = 0; i < count; i += 1) {
    const chunkStart = i * serverChunkSize;
    const chunkLength = Math.min(serverChunkSize, databaseLengthBytes - chunkStart);
    const readLength = Math.min(requestChunkSize, chunkLength);
    const suffix = String(i).padStart(suffixLength, '0');
    targets.push({
      url: `${urlPrefix}${suffix}?cb=${encodeURIComponent(version)}`,
      rangeHeader: `bytes=0-${readLength - 1}`,
    });
  }
  return targets;
}

// Fetch with a bounded timeout via AbortController; the caller decides what a
// timeout or error means. Returns the Response; throws on network error/timeout.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// The deploy cache-bust the browser appends as ?cb=<version>. Prefer the SERVED
// data/version.txt (the exact value the browser uses); fall back to GITHUB_SHA in
// CI; give up (returning undefined) rather than prime a wrong cache key that
// warms nothing the browser will read.
async function resolveVersion(baseUrl: string): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(new URL(LEDGER_VERSION_PATH, baseUrl).toString(), { method: 'GET' }, WARMUP_META_TIMEOUT_MS);
    if (res.ok) {
      const body = (await res.text()).trim();
      if (body !== '') return body;
    }
  } catch {
    // fall through to the env fallback
  }
  const sha = process.env.GITHUB_SHA;
  return sha !== undefined && sha.trim() !== '' ? sha.trim() : undefined;
}

// Read and shape the served chunk manifest. Returns undefined (logged by the
// caller) if it is missing or malformed - the warm-up then simply skips.
async function fetchManifest(baseUrl: string): Promise<LedgerChunkManifest | undefined> {
  const res = await fetchWithTimeout(new URL(LEDGER_MANIFEST_PATH, baseUrl).toString(), { method: 'GET' }, WARMUP_META_TIMEOUT_MS);
  if (!res.ok) return undefined;
  const raw: unknown = await res.json();
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { databaseLengthBytes, serverChunkSize, suffixLength } = raw as Record<string, unknown>;
  if (typeof databaseLengthBytes !== 'number' || typeof serverChunkSize !== 'number' || typeof suffixLength !== 'number') {
    return undefined;
  }
  return { databaseLengthBytes, serverChunkSize, suffixLength };
}

// Prime the CDN edge for the ledger's cold-open first reads against `baseUrl`.
// Best-effort and bounded: reads the manifest and version, primes the leading
// chunk(s), and logs a one-line summary. Any failure - a missing manifest, an
// unresolvable version, a slow or erroring read - is logged and swallowed so the
// job proceeds straight to the (retained) settle assertion. Never throws.
export async function primeLedgerCdn(baseUrl: string): Promise<void> {
  try {
    const [manifest, version] = await Promise.all([fetchManifest(baseUrl), resolveVersion(baseUrl)]);
    if (manifest === undefined) {
      console.log('  warm ledger CDN skipped - chunk manifest missing or malformed');
      return;
    }
    if (version === undefined) {
      console.log('  warm ledger CDN skipped - deploy version unresolved (no version.txt or GITHUB_SHA)');
      return;
    }
    const urlPrefix = new URL(`data/${LEDGER_CHUNK_BASE}.`, baseUrl).toString();
    const targets = ledgerWarmupTargets(manifest, urlPrefix, version, {
      maxChunks: MAX_PRIMED_CHUNKS,
      requestChunkSize: REQUEST_CHUNK_SIZE,
    });
    if (targets.length === 0) {
      console.log('  warm ledger CDN skipped - manifest implies no chunks to prime');
      return;
    }
    let primed = 0;
    for (const target of targets) {
      try {
        const res = await fetchWithTimeout(target.url, { method: 'GET', headers: { Range: target.rangeHeader } }, WARMUP_READ_TIMEOUT_MS);
        // 206 (partial) is the expected shape; 200 (full) still warms the object.
        if (res.status === 206 || res.status === 200) {
          primed += 1;
        } else {
          console.log(`  warm ledger CDN read ${target.url} returned HTTP ${res.status}`);
        }
        // Drain the small body so the socket returns to undici's pool promptly.
        await res.arrayBuffer().catch(() => undefined);
      } catch (err) {
        console.log(`  warm ledger CDN read ${target.url} failed: ${String(err)}`);
      }
    }
    console.log(`  warm ledger CDN primed ${primed}/${targets.length} leading chunk(s) at cb=${version}`);
  } catch (err) {
    // A warm-up that errors must not abort the check - the settle timeout is the
    // real safety net. Log and proceed.
    console.log(`  warm ledger CDN skipped - ${String(err)}`);
  }
}
