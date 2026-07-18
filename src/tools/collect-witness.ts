#!/usr/bin/env node

/**
 * Collection tooling (issue #618 increment 5, with #619) - the "collect all
 * witnesses" harvester made operational.
 *
 * Given a URL and the held file it is a copy of, this fetches the bytes
 * (courtesy-paced, honest User-Agent, one attempt, hard abort on a blocking
 * status), hashes them, and compares the hash against the bytes the mirror
 * already holds - then emits the declaration the archive metadata needs:
 *
 *  - byte-identical -> a corroborating witness (`channel`, `url`, `fetchedAt`,
 *    `sha256`, `originalFilename`) to add to the held file's witnesses[]. The
 *    copy is NOT stored a second time (store-once, witness-many, #619);
 *  - anything differing at all (even one byte) -> the copy is retained in full
 *    as a `role: 'divergent-copy'` file `divergesFrom` the faithful held copy,
 *    plus a stub `divergences[]` record for a human to complete (the machine
 *    cannot describe WHAT differs, only THAT it differs).
 *
 * Acquisition posture (settled on #618/#619): opportunistic download/fetch is
 * unrestricted - fetching is equivalent in kind to viewing a page in a browser.
 * Only UPLOAD/REDISTRIBUTION is gated. Where a copy's redistribution basis is
 * not cleared, its bytes are held in a LOCAL, gitignored holdings area and a
 * PUBLIC index entry records their existence (hash, size, original filename,
 * provenance, fetch date, and the obtain-from pointer with the expected hash),
 * so the record of availability stays public and re-verifiable even though the
 * bytes are withheld. Republication is always a deliberate, manual, per-item
 * decision - never performed by this tool.
 *
 * Design grain: every logic-bearing piece (filename derivation, hashing,
 * channel resolution, agreement classification, witness/divergence emission,
 * the holdings index) is a pure, exported, unit-tested function. Only the
 * network fetch is impure, and it is injectable so the tests exercise the real
 * hashing/comparison/emission with a mocked fetch (issue #618 increment 5's
 * "fetch mocked; hashing/comparison/emission real").
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  type PublisherRegister,
  readPublisherRegister,
  publisherIndexById,
} from '../shared/publishers.ts';
import {
  type WitnessAgreement,
  type DivergenceRecord,
  classifyWitnessAgreement,
  heldHashSet,
} from '../shared/witness-agreement.ts';
import type { FoiWitness, FoiFileDeclaration } from '../shared/foi-archive.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// ---------------------------------------------------------------------------
// Courtesy posture
// ---------------------------------------------------------------------------

// The honest, identifying User-Agent. It names the project and its purpose and
// masquerades as no browser - WhatDoTheyKnow deliberately rejects browser-spoof
// UAs from scripted clients (418), and honesty is the recorded posture for
// every lane. A contact address is appended when COLLECT_WITNESS_CONTACT is set,
// so an operator can be reached without committing a personal address to source.
export function defaultUserAgent(contact: string | undefined = process.env.COLLECT_WITNESS_CONTACT): string {
  const base = 'amateur-callsigns-file-watch data-mirror (courtesy fetch; one request per URL)';
  return contact && contact.trim().length > 0 ? `${base} (contact: ${contact.trim()})` : base;
}

// Statuses that ABORT the fetch rather than being read as an answer. 404/410 are
// legitimate "not held" answers (a dead archive URL is a fact, not a block);
// 403/429 and any 5xx are the server telling us to back off, and are treated as
// hard failures so a run stops rather than hammering a host (the recorded
// courtesy rule: hard abort on the first blocking status).
export function isBlockingStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

export const DEFAULT_TIMEOUT_MS = 60_000;
// Seconds between sequential requests to the same host - WDTK/archive courtesy
// pacing. The tool paces; it never parallelises fetches against one host.
export const DEFAULT_COURTESY_DELAY_MS = 5_000;

// ---------------------------------------------------------------------------
// Original filename (provenance the sanitised held name may have lost, #619)
// ---------------------------------------------------------------------------

// The filename a URL's path implies: its last non-empty path segment, query and
// fragment stripped, percent-decoded. Returns undefined when the URL carries no
// usable path segment (a bare host, a directory).
export function originalFilenameFromUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const segments = parsed.pathname.split('/').filter(s => s.length > 0);
  const last = segments.at(-1);
  if (last === undefined) return undefined;
  try {
    const decoded = decodeURIComponent(last);
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return last;
  }
}

// The filename a Content-Disposition header declares. Prefers RFC 5987
// `filename*=charset''percent-encoded` when present (it carries the true name),
// falling back to a plain quoted or bare `filename=`. Returns undefined when the
// header names none.
export function originalFilenameFromContentDisposition(header: string | undefined | null): string | undefined {
  if (typeof header !== 'string') return undefined;
  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
  if (extended?.[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      return extended[1].trim();
    }
  }
  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(header);
  const name = plain?.[2]?.trim();
  return name && name.length > 0 ? name : undefined;
}

// The best original filename available: the Content-Disposition name (the
// server's own claim) when present, else the name implied by the URL path.
export function resolveOriginalFilename(url: string, contentDisposition?: string | null): string | undefined {
  return originalFilenameFromContentDisposition(contentDisposition) ?? originalFilenameFromUrl(url);
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

// The sha256 of some bytes, as 64 lowercase hex - the form the witness schema
// and the agreement derivation both use.
export function sha256OfBytes(bytes: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Channel resolution via the publisher register
// ---------------------------------------------------------------------------

// Resolve the witness `channel` token to record for a fetch, via the register:
// the token must belong to the named publisher. When the publisher owns exactly
// one channel it is used automatically; when it owns several (Ofcom serves an
// open-data page AND a disclosure log) an explicit channel is required, and it
// must be one the publisher actually owns. Throws with a helpful message rather
// than guessing - a mis-recorded channel would silently mis-attribute a copy.
export function resolveWitnessChannel(
  register: PublisherRegister,
  publisherId: string,
  explicitChannel?: string,
): string {
  const publisher = publisherIndexById(register).get(publisherId);
  if (publisher === undefined) {
    throw new Error(`publisher "${publisherId}" is not in the register (reference-data/publishers.json)`);
  }
  if (explicitChannel !== undefined) {
    if (!publisher.channels.includes(explicitChannel)) {
      throw new Error(
        `channel "${explicitChannel}" is not owned by publisher "${publisherId}" (its channels: ${publisher.channels.join(', ') || 'none'})`,
      );
    }
    return explicitChannel;
  }
  if (publisher.channels.length === 1) return publisher.channels[0];
  if (publisher.channels.length === 0) {
    throw new Error(`publisher "${publisherId}" declares no witness channels; add one to the register or pass an explicit channel`);
  }
  throw new Error(
    `publisher "${publisherId}" owns several channels (${publisher.channels.join(', ')}); pass an explicit channel to disambiguate`,
  );
}

// ---------------------------------------------------------------------------
// Fetch (the only impure piece; injectable for tests)
// ---------------------------------------------------------------------------

export interface FetchedResource {
  bytes: Buffer;
  sha256: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  contentDisposition?: string;
  // The filename resolved from Content-Disposition or the URL, at fetch time.
  originalFilename?: string;
}

// A minimal Response shape - the subset this tool reads, so a test double need
// only supply these. The global fetch's Response satisfies it structurally.
export interface FetchLikeResponse {
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: 'follow'; signal: AbortSignal }) => Promise<FetchLikeResponse>;

export interface FetchOptions {
  userAgent?: string;
  timeoutMs?: number;
  // Injected for tests; defaults to the global fetch.
  fetchImpl?: FetchLike;
}

// Fetch one URL, following redirects, with an honest UA and a timeout. A
// blocking status throws (hard abort); any other status returns the bytes and
// their hash (a 404 body is still returned - the caller decides what an empty
// "not held" answer means). One attempt only: no retry loop hammers a host.
export async function fetchResource(url: string, opts: FetchOptions = {}): Promise<FetchedResource> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const userAgent = opts.userAgent ?? defaultUserAgent();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: FetchLikeResponse;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, 'Accept': '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (isBlockingStatus(response.status)) {
    throw new Error(`fetch aborted: ${url} returned a blocking status ${response.status} (backing off, not retrying)`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? undefined;
  const contentDisposition = response.headers.get('content-disposition') ?? undefined;
  return {
    bytes,
    sha256: sha256OfBytes(bytes),
    finalUrl: response.url || url,
    status: response.status,
    contentType,
    contentDisposition,
    originalFilename: resolveOriginalFilename(response.url || url, contentDisposition),
  };
}

// Courtesy pause between sequential fetches. Injectable sleep for tests.
export function courtesyDelay(ms: number = DEFAULT_COURTESY_DELAY_MS, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<void> {
  return sleep(ms);
}
function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Comparison + emission (real-tested)
// ---------------------------------------------------------------------------

export interface CollectionParams {
  // The held file this copy claims to be (a declared file name in the entry).
  heldFile: string;
  // The sha256s the mirror already holds for the entry (all its files).
  heldHashes: Iterable<string>;
  // The witness channel token (already resolved via the register).
  channel: string;
  // The publisher id (for the divergence counterpart, if the copy diverges).
  publisherId: string;
  url: string;
  fetchedAt: string;
  // The hash of the bytes this copy served.
  sha256: string;
  originalFilename?: string;
  note?: string;
  // The file name a divergent copy is retained under (role divergent-copy).
  // Defaults to a deterministic name derived from the original filename.
  heldAs?: string;
}

export interface CollectionOutcome {
  agreement: WitnessAgreement;
  // The witness to record. For a corroborating copy it attaches to the held
  // file's witnesses[]; for a divergent copy it attaches to the divergent-copy
  // file's witnesses[] (whose sha256 it matches once that copy is held).
  witness: FoiWitness;
  // Present only when the copy diverges: the file to retain in full plus a stub
  // divergence record for a human to complete (the `summary`/`enumeration` say
  // TODO because only a person can describe WHAT differs).
  divergence?: {
    fileName: string;
    fileDeclaration: FoiFileDeclaration;
    record: DivergenceRecord;
  };
}

// Deterministic default name for a retained divergent copy: prefixed so it can
// never collide with the faithful held file, and carrying the original name for
// provenance. Falls back to the hash when no original filename is known.
export function divergentCopyName(originalFilename: string | undefined, sha256: string): string {
  const stem = originalFilename && originalFilename.trim().length > 0 ? originalFilename.trim() : `${sha256.slice(0, 12)}.bin`;
  return `divergent-copy--${stem}`;
}

// Classify a fetched copy against the held bytes and emit the declaration it
// needs. A copy the mirror can prove it holds (hash matches a held file) is
// corroborating; anything else is divergent and retained in full with a stub
// record. `bytes` is the length of the fetched copy (for the file declaration).
export function collectionOutcome(params: CollectionParams, bytes: number): CollectionOutcome {
  const held = heldHashSet(params.heldHashes);
  const agreement = classifyWitnessAgreement(params.sha256, held);

  const witness: FoiWitness = {
    channel: params.channel,
    url: params.url,
    fetchedAt: params.fetchedAt,
    sha256: params.sha256,
    ...(params.originalFilename !== undefined ? { originalFilename: params.originalFilename } : {}),
    ...(params.note !== undefined ? { note: params.note } : {}),
  };

  if (agreement === 'corroborating') {
    return { agreement, witness };
  }

  // Divergent: retain the copy in full and stub a record for hand-completion.
  const heldAs = params.heldAs ?? divergentCopyName(params.originalFilename, params.sha256);
  const fileDeclaration: FoiFileDeclaration = {
    bytes,
    sha256: params.sha256,
    role: 'divergent-copy',
    divergesFrom: params.heldFile,
    contentsIndicative: `TODO: describe this divergent copy of ${params.heldFile} (what differs, and why the held copy remains the faithful parse source).`,
    witnesses: [witness],
  };
  const record: DivergenceRecord = {
    file: params.heldFile,
    counterpart: {
      publisher: params.publisherId,
      url: params.url,
      sha256: params.sha256,
      ...(params.originalFilename !== undefined ? { originalFilename: params.originalFilename } : {}),
      heldAs,
    },
    level: 'bytes',
    summary: `TODO: describe how ${heldAs} differs from ${params.heldFile} (byte-level difference detected on collection; a human must characterise it).`,
    enumeration: 'TODO: enumerate the difference, or point to a committed diff artefact.',
  };
  return { agreement, witness, divergence: { fileName: heldAs, fileDeclaration, record } };
}

// ---------------------------------------------------------------------------
// Local holdings index (public index of withheld, not-yet-redistributable bytes)
// ---------------------------------------------------------------------------

// The default committed index and the gitignored bytes directory beside it.
export const HOLDINGS_INDEX_PATH = path.resolve(import.meta.dirname, '..', '..', 'archive', 'local-holdings', 'index.json');
export const HOLDINGS_BYTES_DIRNAME = 'bytes';

export interface HoldingsIndexEntry {
  // sha256 of the withheld bytes - the pairing key AND the value a re-fetcher
  // checks their own copy against.
  sha256: string;
  bytes: number;
  originalFilename?: string;
  // The publisher the bytes were obtained from (a register id).
  publisher: string;
  // The URL to obtain the bytes from, for anyone who wants to verify.
  obtainFrom: string;
  fetchedAt: string;
  // Why the bytes are withheld rather than redistributed (the uncleared basis).
  withheldReason: string;
  // The gitignored local path the bytes are held at, relative to the index
  // (documentary only - the bytes are never committed).
  localPath?: string;
  note?: string;
}

export interface HoldingsIndex {
  schemaVersion: number;
  // A human-facing statement of what this index is, rendered where it surfaces.
  description: string;
  entries: HoldingsIndexEntry[];
}

export const HOLDINGS_INDEX_SCHEMA_VERSION = 1;
const HOLDINGS_INDEX_DESCRIPTION =
  'Public index of copies held locally but not (yet) redistributed: the bytes are gitignored under bytes/, this index records their existence so the availability claim stays public and re-verifiable. Obtain and verify a copy yourself from obtainFrom against the recorded sha256. Redistribution is a deliberate, manual, per-item decision (issue #618/#619).';

export function emptyHoldingsIndex(): HoldingsIndex {
  return { schemaVersion: HOLDINGS_INDEX_SCHEMA_VERSION, description: HOLDINGS_INDEX_DESCRIPTION, entries: [] };
}

export function buildHoldingsIndexEntry(params: {
  sha256: string;
  bytes: number;
  originalFilename?: string;
  publisher: string;
  obtainFrom: string;
  fetchedAt: string;
  withheldReason: string;
  localPath?: string;
  note?: string;
}): HoldingsIndexEntry {
  return {
    sha256: params.sha256,
    bytes: params.bytes,
    ...(params.originalFilename !== undefined ? { originalFilename: params.originalFilename } : {}),
    publisher: params.publisher,
    obtainFrom: params.obtainFrom,
    fetchedAt: params.fetchedAt,
    withheldReason: params.withheldReason,
    ...(params.localPath !== undefined ? { localPath: params.localPath } : {}),
    ...(params.note !== undefined ? { note: params.note } : {}),
  };
}

// Add or replace an entry, keyed by sha256 (same bytes never indexed twice; a
// re-fetch updates the record in place). Returns a new index; does not mutate.
export function upsertHoldingsIndexEntry(index: HoldingsIndex, entry: HoldingsIndexEntry): HoldingsIndex {
  const entries = index.entries.filter(e => e.sha256 !== entry.sha256);
  entries.push(entry);
  entries.sort((a, b) => a.sha256.localeCompare(b.sha256));
  return { ...index, entries };
}

export function readHoldingsIndex(indexPath: string = HOLDINGS_INDEX_PATH): HoldingsIndex {
  if (!fs.existsSync(indexPath)) return emptyHoldingsIndex();
  return parseJsonObject(fs.readFileSync(indexPath, 'utf8'), indexPath) as HoldingsIndex;
}

export function writeHoldingsIndex(index: HoldingsIndex, indexPath: string = HOLDINGS_INDEX_PATH): void {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  url?: string;
  publisher?: string;
  channel?: string;
  heldFile?: string;
  held: string[];
  fetchedAt?: string;
  localOnly: boolean;
  withheldReason?: string;
  save?: string;
  userAgent?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { held: [], localOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--url': args.url = next(); break;
      case '--publisher': args.publisher = next(); break;
      case '--channel': args.channel = next(); break;
      case '--held-file': args.heldFile = next(); break;
      case '--held': args.held.push(next()); break;
      case '--fetched-at': args.fetchedAt = next(); break;
      case '--local-only': args.localOnly = true; break;
      case '--withheld-reason': args.withheldReason = next(); break;
      case '--save': args.save = next(); break;
      case '--user-agent': args.userAgent = next(); break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

const USAGE = `collect-witness - fetch a copy, hash it, compare to held bytes, emit the witness/divergence declaration.

  --url <url>            the copy to fetch (required)
  --publisher <id>       the register publisher the copy is served by (required)
  --channel <token>      the witness channel (required only when the publisher owns several)
  --held-file <name>     the held file this copy claims to be (required unless --local-only)
  --held <sha256>        a hash the mirror holds (repeatable); used to classify agreement
  --fetched-at <iso>     the fetch date to record (default: today, UTC date)
  --local-only           record in the local holdings index instead (withheld bytes)
  --withheld-reason <s>  why bytes are withheld (required with --local-only)
  --save <path>          also write the fetched bytes to this path
  --user-agent <s>       override the honest default User-Agent

Emits JSON to stdout: the witness (and, if the copy diverges, the divergent-copy
file declaration and the stub divergence record) for hand-insertion into meta.json.`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.url === undefined || args.publisher === undefined) {
    process.stderr.write(`${USAGE}\n`);
    throw new Error('--url and --publisher are required');
  }
  const fetchedAt = args.fetchedAt ?? new Date().toISOString().slice(0, 10);
  const register = readPublisherRegister();
  const resource = await fetchResource(args.url, { userAgent: args.userAgent });

  process.stderr.write(
    `fetched ${args.url}\n  status ${resource.status}, ${resource.bytes.length} bytes, sha256 ${resource.sha256}\n  original filename: ${resource.originalFilename ?? '(none)'}\n`,
  );

  if (args.save !== undefined) {
    fs.mkdirSync(path.dirname(path.resolve(args.save)), { recursive: true });
    fs.writeFileSync(args.save, resource.bytes);
    process.stderr.write(`  saved bytes to ${args.save}\n`);
  }

  if (args.localOnly) {
    if (args.withheldReason === undefined) throw new Error('--withheld-reason is required with --local-only');
    const entry = buildHoldingsIndexEntry({
      sha256: resource.sha256,
      bytes: resource.bytes.length,
      originalFilename: resource.originalFilename,
      publisher: args.publisher,
      obtainFrom: args.url,
      fetchedAt,
      withheldReason: args.withheldReason,
    });
    process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
    return;
  }

  if (args.heldFile === undefined) throw new Error('--held-file is required (or use --local-only)');
  const channel = resolveWitnessChannel(register, args.publisher, args.channel);
  const outcome = collectionOutcome(
    {
      heldFile: args.heldFile,
      heldHashes: args.held,
      channel,
      publisherId: args.publisher,
      url: args.url,
      fetchedAt,
      sha256: resource.sha256,
      originalFilename: resource.originalFilename,
    },
    resource.bytes.length,
  );

  process.stderr.write(`  agreement: ${outcome.agreement}\n`);
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
