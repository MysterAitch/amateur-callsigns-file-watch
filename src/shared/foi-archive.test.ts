import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readFoiEntryMeta, type FoiEntryMeta } from './foi-archive.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// readFoiEntryMeta is the FOI lane's shared meta.json reader, fanned out to
// ~20 consumers (every FOI-reading builder, every v2 collector, several CI
// scripts). It must keep throwing on malformed input - no consumer's contract
// changes here - but the throw must NAME the offending file and say what is
// wrong with it, rather than surfacing a bare, unlocated SyntaxError or
// TypeError (fail-loud-but-locatable).

describe('readFoiEntryMeta', { tags: ['unit'] }, () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  });

  function makeEntry(key: string, metaContents: string | undefined): string {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-foi-meta-'));
    const entryDir = path.join(tmpRoot, key);
    fs.mkdirSync(entryDir, { recursive: true });
    if (metaContents !== undefined) {
      fs.writeFileSync(path.join(entryDir, 'meta.json'), metaContents, 'utf8');
    }
    return tmpRoot;
  }

  it('ReadFoiEntryMeta_WhenFileContainsInvalidJson_ThrowsLocatedErrorNamingTheFile', () => {
    // A truncated write or an unresolved merge-conflict marker left in place -
    // the reader must not surface a bare, unlocated SyntaxError.
    const foiDir = makeEntry('wdtk-1234567-example', '<<<<<<< HEAD\n{"broken":\n');
    const metaPath = path.join(foiDir, 'wdtk-1234567-example', 'meta.json');

    expect(() => readFoiEntryMeta(foiDir, 'wdtk-1234567-example')).toThrowError(
      new RegExp(`${escapeForRegExp(metaPath)}.*not valid JSON`, 's'),
    );
  });

  it('ReadFoiEntryMeta_WhenMetaIsJsonNull_ThrowsLocatedErrorNamingTheFile', () => {
    const foiDir = makeEntry('wdtk-1234567-example', 'null');
    const metaPath = path.join(foiDir, 'wdtk-1234567-example', 'meta.json');

    expect(() => readFoiEntryMeta(foiDir, 'wdtk-1234567-example')).toThrowError(
      new RegExp(`${escapeForRegExp(metaPath)}.*expected a JSON object.*null`, 's'),
    );
  });

  it('ReadFoiEntryMeta_WhenMetaIsJsonArray_ThrowsLocatedError', () => {
    const foiDir = makeEntry('wdtk-1234567-example', '[]');
    const metaPath = path.join(foiDir, 'wdtk-1234567-example', 'meta.json');

    expect(() => readFoiEntryMeta(foiDir, 'wdtk-1234567-example')).toThrowError(
      new RegExp(`${escapeForRegExp(metaPath)}.*expected a JSON object`, 's'),
    );
  });

  it('ReadFoiEntryMeta_WhenMetaIsMissing_ThrowsLocatedError', () => {
    const foiDir = makeEntry('wdtk-1234567-example', undefined);
    const metaPath = path.join(foiDir, 'wdtk-1234567-example', 'meta.json');

    expect(() => readFoiEntryMeta(foiDir, 'wdtk-1234567-example')).toThrowError(
      new RegExp(escapeForRegExp(metaPath)),
    );
  });

  it('ReadFoiEntryMeta_WhenWellFormed_ParsesToTheExpectedObject', () => {
    const meta: FoiEntryMeta = {
      schemaVersion: 1,
      sourceKey: 'wdtk-1234567-example',
      requestId: 1234567,
      ofcomReference: null,
      requestUrl: 'https://www.whatdotheyknow.com/request/example',
      title: 'Example FOI request',
      requester: 'A. Requester',
      requestedAt: '2024-01-01',
      respondedAt: '2024-02-01',
      outcome: 'successful',
      dataVintage: '2024-01-01',
      datasetClasses: ['register-snapshot'],
      converter: null,
      files: {},
    };
    const foiDir = makeEntry('wdtk-1234567-example', JSON.stringify(meta));

    expect(readFoiEntryMeta(foiDir, 'wdtk-1234567-example')).toEqual(meta);
  });
});

// Windows paths contain backslashes; escape before embedding a path in a
// RegExp so the match is literal rather than a broken pattern.
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
