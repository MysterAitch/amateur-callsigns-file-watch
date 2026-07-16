import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { mimeTypeFor, resolveFile, parseRange, startServer } from './serve-site.ts';

// Unit tests for the committed local static-serve script (issue #600). The
// server-integration tests below always bind port 0 (an OS-assigned ephemeral
// port) against a throwaway fixture directory - never the fixed default port
// `npm run serve:site` uses - so this suite never contends with a real
// instance of the script running locally. Test names follow
// Subject_Scenario_Outcome.

describe('serve-site — mimeTypeFor', { tags: ['unit'] }, () => {
  it('MimeTypeFor_WhenHtmlFile_ReturnsTextHtml', () => {
    expect(mimeTypeFor('index.html')).toBe('text/html; charset=utf-8');
  });

  it('MimeTypeFor_WhenSqlitePngCostumeFile_ReturnsImagePng', () => {
    // The sql.js-httpvfs range-served databases wear a `.sqlite.png` name so
    // GitHub Pages never gzip-transcodes their Range responses (site/app.js).
    // The real (only) extension is `.png`, so the plain extension lookup
    // already resolves the costume correctly with no special-casing.
    expect(mimeTypeFor('callsigns.sqlite.png')).toBe('image/png');
    expect(mimeTypeFor('data/claim-ledger.sqlite.png')).toBe('image/png');
  });

  it('MimeTypeFor_WhenWasmFile_ReturnsApplicationWasm', () => {
    expect(mimeTypeFor('vendor/sql-wasm.wasm')).toBe('application/wasm');
  });

  it('MimeTypeFor_WhenWebmanifestFile_ReturnsManifestJson', () => {
    expect(mimeTypeFor('site.webmanifest')).toBe('application/manifest+json; charset=utf-8');
  });

  it('MimeTypeFor_WhenJsonFile_ReturnsApplicationJson', () => {
    expect(mimeTypeFor('data/version.json')).toBe('application/json; charset=utf-8');
  });

  it('MimeTypeFor_WhenSvgFile_ReturnsImageSvgXml', () => {
    expect(mimeTypeFor('icon.svg')).toBe('image/svg+xml');
  });

  it('MimeTypeFor_WhenExtensionUnknown_FallsBackToOctetStream', () => {
    expect(mimeTypeFor('claim-ledger.sqlite.png.000')).toBe('application/octet-stream');
  });
});

describe('serve-site — parseRange', { tags: ['unit'] }, () => {
  it('ParseRange_WhenHeaderAbsent_ReturnsFull', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'full' });
  });

  it('ParseRange_WhenBoundedRange_ReturnsStartAndEnd', () => {
    expect(parseRange('bytes=2-5', 100)).toEqual({ kind: 'range', start: 2, end: 5 });
  });

  it('ParseRange_WhenOpenEnded_ReturnsThroughFinalByte', () => {
    expect(parseRange('bytes=10-', 100)).toEqual({ kind: 'range', start: 10, end: 99 });
  });

  it('ParseRange_WhenSuffixForm_ReturnsLastNBytes', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'range', start: 90, end: 99 });
  });

  it('ParseRange_WhenStartBeyondSize_ReturnsUnsatisfiable', () => {
    expect(parseRange('bytes=200-300', 100)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ParseRange_WhenUnitIsNotBytes_ReturnsFull', () => {
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'full' });
  });

  it('ParseRange_WhenEndExceedsSize_ClampsToFinalByte', () => {
    expect(parseRange('bytes=90-999', 100)).toEqual({ kind: 'range', start: 90, end: 99 });
  });
});

describe('serve-site — resolveFile', { tags: ['unit'] }, () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-site-resolve-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<p>root</p>');
    fs.mkdirSync(path.join(root, 'foo'));
    fs.writeFileSync(path.join(root, 'foo', 'index.html'), '<p>foo</p>');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ResolveFile_WhenRootPath_ReturnsRootIndexHtml', () => {
    expect(resolveFile(root, '/')).toBe(path.join(root, 'index.html'));
  });

  it('ResolveFile_WhenDirectoryPathWithTrailingSlash_ReturnsDirectoryIndexHtml', () => {
    expect(resolveFile(root, '/foo/')).toBe(path.join(root, 'foo', 'index.html'));
  });

  it('ResolveFile_WhenDirectoryPathWithoutTrailingSlash_FallsBackToDirectoryIndexHtml', () => {
    expect(resolveFile(root, '/foo')).toBe(path.join(root, 'foo', 'index.html'));
  });

  it('ResolveFile_WhenPathEscapesRootViaTraversal_ReturnsUndefined', () => {
    expect(resolveFile(root, '/../../etc/passwd')).toBeUndefined();
  });

  it('ResolveFile_WhenPathDoesNotExist_ReturnsUndefined', () => {
    expect(resolveFile(root, '/does-not-exist.html')).toBeUndefined();
  });
});

describe('serve-site — HTTP server', { tags: ['unit'] }, () => {
  let root: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-site-http-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<p>home</p>');
    // A deterministic byte sequence long enough to slice a meaningful Range
    // out of, standing in for a real `.sqlite.png` database file.
    fs.writeFileSync(path.join(root, 'callsigns.sqlite.png'), Buffer.from(Array.from({ length: 32 }, (_, i) => i)));

    // Bind port 0: the OS assigns a free ephemeral port, so this suite never
    // touches (or contends with) the fixed default `npm run serve:site` uses.
    const started = await startServer(root, 0);
    server = started.server;
    baseUrl = `http://localhost:${started.port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('Server_WhenRequestingIndex_Returns200WithHtmlContentType', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('<p>home</p>');
  });

  it('Server_WhenRequestingMissingPath_Returns404', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist.html`);
    expect(res.status).toBe(404);
  });

  it('Server_WhenRequestingRangeOfSqlitePngFile_Returns206WithCorrectByteSliceAndImagePngType', async () => {
    const res = await fetch(`${baseUrl}/callsigns.sqlite.png`, { headers: { Range: 'bytes=4-9' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-range')).toBe('bytes 4-9/32');

    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('Server_WhenNoRangeRequested_Returns200WithAcceptRangesHeader', async () => {
    const res = await fetch(`${baseUrl}/callsigns.sqlite.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('32');
  });

  it('Server_WhenRangeStartsBeyondFileSize_Returns416', async () => {
    const res = await fetch(`${baseUrl}/callsigns.sqlite.png`, { headers: { Range: 'bytes=1000-2000' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */32');
  });
});
