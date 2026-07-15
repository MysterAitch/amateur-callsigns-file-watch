import { describe, it, expect } from 'vitest';
import {
  reconcilePullRequests,
  type GhRunner,
} from './pr-dataset-labels.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The scheduled-lane reconciler (issue #158) reads each open PR's changed
// archive meta.json as pure data via the GitHub API and reconciles the
// dataset-class labels. These tests drive the orchestrator with a fake `gh`
// runner - so they exercise the exact command sequence WITHOUT touching the
// live repository, creating labels, or mutating any PR.

// A recording fake for the `gh` CLI. Canned responses are keyed by a substring
// match against the argument vector; every invocation is recorded so tests can
// assert which mutating calls were (or were not) issued.
interface FakeGhOptions {
  prList: unknown;
  filesByPr: Record<number, string[]>;
  metaByPathAndRef: Record<string, string>; // key: `${ref}:${path}` -> JSON text
  existingLabels: string[];
}

function makeFakeGh(opts: FakeGhOptions): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'list') {
      return JSON.stringify(opts.prList);
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const number = Number(args[2]);
      const paths = opts.filesByPr[number] ?? [];
      return JSON.stringify({ files: paths.map((path) => ({ path })) });
    }
    if (args[0] === 'api') {
      // repos/{owner}/{repo}/contents/<path> -f ref=<ref> --jq .content
      const pathArg = args[1].replace('repos/{owner}/{repo}/contents/', '');
      const refFlag = args.indexOf('-f');
      const ref = refFlag >= 0 ? args[refFlag + 1].replace('ref=', '') : '';
      const meta = opts.metaByPathAndRef[`${ref}:${pathArg}`];
      if (meta === undefined) throw new Error(`no fake content for ${ref}:${pathArg}`);
      return Buffer.from(meta, 'utf8').toString('base64');
    }
    if (args[0] === 'label' && args[1] === 'list') {
      return opts.existingLabels.join('\n');
    }
    if (args[0] === 'label' && args[1] === 'create') return '';
    if (args[0] === 'pr' && args[1] === 'edit') return '';
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { gh, calls };
}

const metaJson = (classes: string[]): string =>
  JSON.stringify({ schemaVersion: 1, datasetClasses: classes });

describe('scheduled-lane PR dataset-class reconciler', { tags: ['unit'] }, () => {
  it('Reconcile_PrWithFoiMetaClasses_AddsDerivedLabels', () => {
    const { gh, calls } = makeFakeGh({
      prList: [{ number: 7, headRefOid: 'sha7', labels: [{ name: 'chore' }] }],
      filesByPr: { 7: ['archive/foi/ofcom-x--reissued/meta.json'] },
      metaByPathAndRef: {
        'sha7:archive/foi/ofcom-x--reissued/meta.json': metaJson(['issuance-events']),
      },
      existingLabels: ['chore', 'issuance-events'],
    });

    const report = reconcilePullRequests(gh, { log: () => {} });

    expect(report.pullRequests).toHaveLength(1);
    expect(report.pullRequests[0].added).toEqual(['issuance-events']);
    expect(report.pullRequests[0].removed).toEqual([]);
    // The label already existed, so no create; the add was applied.
    expect(calls.some((c) => c[0] === 'label' && c[1] === 'create')).toBe(false);
    const edit = calls.find((c) => c[0] === 'pr' && c[1] === 'edit');
    expect(edit).toBeDefined();
    expect(edit?.join(' ')).toContain('--add-label');
    expect(edit?.join(' ')).toContain('issuance-events');
  });

  it('Reconcile_MissingLabel_CreatedBeforeApplyingToPr', () => {
    const { gh, calls } = makeFakeGh({
      prList: [{ number: 9, headRefOid: 'sha9', labels: [] }],
      filesByPr: { 9: ['archive/foi/ofcom-y--forbidden/meta.json'] },
      metaByPathAndRef: {
        'sha9:archive/foi/ofcom-y--forbidden/meta.json': metaJson(['forbidden-list']),
      },
      existingLabels: [], // the vocabulary label does not yet exist in the repo
    });

    const report = reconcilePullRequests(gh, { log: () => {} });

    expect(report.labelsCreated).toEqual(['forbidden-list']);
    const create = calls.find((c) => c[0] === 'label' && c[1] === 'create');
    expect(create).toBeDefined();
    expect(create?.[2]).toBe('forbidden-list');
    expect(create?.join(' ')).toContain('--description');
    expect(create?.join(' ')).toContain('--color');
  });

  it('Reconcile_StaleDatasetClassLabelOnPr_RemovedNotJustAdded', () => {
    const { gh, calls } = makeFakeGh({
      prList: [
        {
          number: 11,
          headRefOid: 'sha11',
          labels: [{ name: 'register-snapshot' }, { name: 'issuance-events' }],
        },
      ],
      filesByPr: { 11: ['archive/foi/ofcom-z--snapshot/meta.json'] },
      metaByPathAndRef: {
        'sha11:archive/foi/ofcom-z--snapshot/meta.json': metaJson(['register-snapshot']),
      },
      existingLabels: ['register-snapshot', 'issuance-events'],
    });

    const report = reconcilePullRequests(gh, { log: () => {} });

    expect(report.pullRequests[0].added).toEqual([]);
    expect(report.pullRequests[0].removed).toEqual(['issuance-events']);
    const edit = calls.find((c) => c[0] === 'pr' && c[1] === 'edit');
    expect(edit?.join(' ')).toContain('--remove-label');
  });

  it('Reconcile_UnknownClassInMeta_SkippedAndReportedNotCrashed', () => {
    const { gh } = makeFakeGh({
      prList: [{ number: 13, headRefOid: 'sha13', labels: [] }],
      filesByPr: { 13: ['archive/foi/ofcom-q--odd/meta.json'] },
      metaByPathAndRef: {
        'sha13:archive/foi/ofcom-q--odd/meta.json': metaJson(['register-snapshot', 'mystery']),
      },
      existingLabels: ['register-snapshot'],
    });

    const report = reconcilePullRequests(gh, { log: () => {} });

    expect(report.pullRequests[0].desiredLabels).toEqual(['register-snapshot']);
    expect(report.pullRequests[0].unknownClasses).toEqual(['mystery']);
  });

  it('Reconcile_PrWithoutMetaChanges_LeftUntouched', () => {
    const { gh, calls } = makeFakeGh({
      prList: [{ number: 15, headRefOid: 'sha15', labels: [{ name: 'chore' }] }],
      filesByPr: { 15: ['src/some-code.ts', 'README.md'] },
      metaByPathAndRef: {},
      existingLabels: ['chore'],
    });

    const report = reconcilePullRequests(gh, { log: () => {} });

    // No archive meta touched -> nothing to derive, nothing edited.
    expect(report.pullRequests).toEqual([]);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
  });

  it('Reconcile_DryRun_PlansButIssuesNoMutatingCalls', () => {
    const { gh, calls } = makeFakeGh({
      prList: [{ number: 17, headRefOid: 'sha17', labels: [] }],
      filesByPr: { 17: ['archive/foi/ofcom-w--stats/meta.json'] },
      metaByPathAndRef: {
        'sha17:archive/foi/ofcom-w--stats/meta.json': metaJson(['statistics-aggregate']),
      },
      existingLabels: [], // would need creating - dry run must NOT create it
    });

    const report = reconcilePullRequests(gh, { dryRun: true, log: () => {} });

    // The plan is still computed and reported...
    expect(report.pullRequests[0].added).toEqual(['statistics-aggregate']);
    expect(report.labelsCreated).toEqual(['statistics-aggregate']);
    // ...but no mutating gh command is issued.
    expect(calls.some((c) => c[0] === 'label' && c[1] === 'create')).toBe(false);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
  });

  it('Reconcile_MalformedMetaContent_DoesNotCrashTheSweep', () => {
    const { gh } = makeFakeGh({
      prList: [{ number: 19, headRefOid: 'sha19', labels: [] }],
      filesByPr: { 19: ['archive/foi/ofcom-broken/meta.json'] },
      metaByPathAndRef: {
        'sha19:archive/foi/ofcom-broken/meta.json': '{ not valid json',
      },
      existingLabels: [],
    });

    const report = reconcilePullRequests(gh, { log: () => {} });

    expect(report.pullRequests[0].parseErrors).toHaveLength(1);
    expect(report.pullRequests[0].desiredLabels).toEqual([]);
  });
});
