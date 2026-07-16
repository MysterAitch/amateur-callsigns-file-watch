#!/usr/bin/env node

/**
 * Committed local static server for the built site (issue #600): serves
 * `_site/` (the Pages build output, never committed - see README) on a fixed
 * default port, so "load the page, check the console" is a one-command step
 * for every lane, and browser-automation checks get a stable origin to grant
 * permissions to once rather than a fresh ad-hoc port every time.
 *
 * node:http + node:fs only - no new runtime dependency. It serves the
 * MIME types the site actually ships, including the `.sqlite.png` costume the
 * Pages deploy wears its range-served SQLite databases in (see
 * site/app.js: GitHub Pages gzip-transcodes text-like content types even on
 * Range responses, which corrupts sql.js-httpvfs reads, but never
 * recompresses image formats). Because the costume is a real `.png`
 * extension, the ordinary extension-to-MIME lookup below already resolves it
 * to `image/png` with no special-casing needed. It also supports HTTP Range
 * requests (206 partial content with a correct `Content-Range`/byte slice),
 * which sql.js-httpvfs requires to query a multi-hundred-MB database without
 * downloading it whole - the interactive lookup/explore/ledger pages will not
 * function without it.
 *
 * Usage: node src/tools/serve-site.ts [port] [root]
 *   port defaults to the SITE_PORT env var, falling back to DEFAULT_PORT
 *   below; root defaults to the repo-root `_site/`. Both are also
 *   overridable so a lane can point the server at a fixture directory.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

// Fixed so a browser's "allow this origin" permission (and any bookmark)
// keeps working across sessions instead of chasing a new ephemeral port each
// run. Picked clear of the ports common local tooling already defaults to
// (3000, 4173/5173, 8000, 8080), so it should not collide with another
// dev server a contributor already has running.
export const DEFAULT_PORT = 4600;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const DEFAULT_MIME_TYPE = 'application/octet-stream';

// Extension-keyed lookup, lower-cased. `callsigns.sqlite.png` resolves via its
// real (only) extension, `.png` - see the module comment above.
export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? DEFAULT_MIME_TYPE;
}

// Resolves a request pathname to an absolute file path under `root`, with
// directory-index fallback (`/` and any `/foo/` resolve to that directory's
// `index.html`; a bare directory hit with no trailing slash falls back to its
// own `index.html` too, mirroring how GitHub Pages serves clean URLs).
// Returns undefined when the decoded path would escape `root` (`..`
// traversal) or nothing on disk matches - both are treated as a 404 by the
// caller, never distinguished, so a traversal attempt reveals nothing about
// the filesystem outside root.
export function resolveFile(root: string, urlPathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return undefined;
  }

  const absoluteRoot = path.resolve(root);
  const relative = decoded.replace(/^\/+/, '');
  let candidate = path.resolve(absoluteRoot, relative);
  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + path.sep)) {
    return undefined;
  }

  if (decoded === '' || decoded.endsWith('/')) {
    candidate = path.join(candidate, 'index.html');
  }

  if (!fs.existsSync(candidate)) return undefined;
  const stats = fs.statSync(candidate);
  if (stats.isDirectory()) {
    const indexed = path.join(candidate, 'index.html');
    return fs.existsSync(indexed) ? indexed : undefined;
  }
  return candidate;
}

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' };

// Parses a `Range: bytes=...` request header against a known file size.
// Supports the forms a range-reading client actually sends - `start-end`,
// open-ended `start-`, and suffix `-length` (last N bytes) - as a single
// range (the only shape sql.js-httpvfs's chunked reads use). Anything absent,
// malformed, or naming a unit other than `bytes` falls back to `full` (serve
// the whole file), matching how a real static host treats a Range header it
// does not recognise.
export function parseRange(rangeHeader: string | undefined, size: number): RangeResult {
  if (rangeHeader === undefined) return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (match === null) return { kind: 'full' };
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return { kind: 'full' };

  let start: number;
  let end: number;
  if (startStr === '') {
    if (size === 0) return { kind: 'unsatisfiable' };
    const suffixLength = Number(endStr);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Number(endStr);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return { kind: 'unsatisfiable' };
  }
  return { kind: 'range', start, end: Math.min(end, size - 1) };
}

// Serves one request: resolves the file, negotiates a Range if one was
// asked for, and streams the response. Synchronous fs calls are deliberate -
// this is a small local dev tool serving files off local disk, not a
// production host under concurrent load, so the simplicity is worth more
// than the (unmeasurable, here) async win.
function handleRequest(root: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end(method === 'HEAD' ? undefined : '405 Method Not Allowed');
    return;
  }

  try {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const filePath = resolveFile(root, requestUrl.pathname);
    if (filePath === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : '404 Not Found');
      return;
    }

    const stats = fs.statSync(filePath);
    const range = parseRange(req.headers.range, stats.size);

    if (range.kind === 'unsatisfiable') {
      res.writeHead(416, { 'Content-Range': `bytes */${stats.size}`, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : '416 Range Not Satisfiable');
      return;
    }

    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': mimeTypeFor(filePath),
      'Accept-Ranges': 'bytes',
    };

    if (range.kind === 'range') {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stats.size}`;
      headers['Content-Length'] = range.end - range.start + 1;
      res.writeHead(206, headers);
      if (method === 'HEAD') { res.end(); return; }
      fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    headers['Content-Length'] = stats.size;
    res.writeHead(200, headers);
    if (method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(method === 'HEAD' ? undefined : `500 Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function createSiteServer(root: string): http.Server {
  return http.createServer((req, res) => { handleRequest(root, req, res); });
}

// Starts the server and resolves once it is actually listening, with the
// PORT IT BOUND - port 0 asks the OS for an ephemeral free port, which is
// what tests use so they never contend with a real `npm run serve:site`
// (or another test worker) sat on the fixed default.
export function startServer(root: string, port: number): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createSiteServer(root);
    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({ server, port: boundPort });
    });
  });
}

function repoRoot(): string {
  return path.resolve(import.meta.dirname, '..', '..');
}

function resolvePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function resolvePort(): number {
  const argPort = process.argv[2];
  if (argPort !== undefined && argPort.trim() !== '') return resolvePositiveInt(argPort, 'port argument');
  const envPort = process.env.SITE_PORT;
  if (envPort !== undefined && envPort.trim() !== '') return resolvePositiveInt(envPort, 'SITE_PORT');
  return DEFAULT_PORT;
}

function resolveRoot(): string {
  const argRoot = process.argv[3];
  if (argRoot !== undefined && argRoot.trim() !== '') return path.resolve(argRoot);
  const envRoot = process.env.SITE_ROOT;
  if (envRoot !== undefined && envRoot.trim() !== '') return path.resolve(envRoot);
  return path.join(repoRoot(), '_site');
}

async function main(): Promise<void> {
  const root = resolveRoot();
  if (!fs.existsSync(root)) {
    throw new Error(`Site root not found: ${root}. Build the site first, or pass a different root as the second argument / SITE_ROOT.`);
  }
  const { port } = await startServer(root, resolvePort());
  console.log(`Serving ${root} at http://localhost:${port}/`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
