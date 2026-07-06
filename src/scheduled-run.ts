#!/usr/bin/env node

/**
 * Scheduled-run orchestrator (Pattern 2).
 *
 * Invoked frequently by systemd (default: every 5 minutes) as a lightweight
 * wake-up. Reads `.notify-state.json` and decides whether to actually do work
 * this tick, based on a small pure decision function `shouldRunNow`. If it
 * decides to run, it invokes scrape + process, then commits and pushes any
 * new archive entry to git, and posts a notification via ntfy. Every
 * successful non-error tick also pings healthchecks as a dead-man's-switch
 * heartbeat, so the "the LXC is off / dead" case is caught externally.
 *
 * All external services are **soft-fail**: if `NTFY_TOPIC_URL` or
 * `HEALTHCHECKS_PING_URL` are unset, the corresponding action is logged and
 * skipped. If they are set but unreachable, the failure is logged and the
 * tick continues - a broken ntfy is not a broken mirror.
 *
 * Design rationale is captured in project memory (`.claude/projects/.../memory/`)
 * and in the surrounding commit messages. Notable rules:
 *  - "Ofcom-touching" cadence is 3x/day at 03:00/10:00/18:00 local, with a
 *    +/- 15-min window. The systemd timer fires every 5 min; the shouldRunNow
 *    gate below decides whether a given tick actually does anything.
 *  - Failure escalation: LOW on the first consecutive failure, DEFAULT on
 *    the second, HIGH on the third and beyond. Ongoing failures are
 *    re-notified at most once per 24h to avoid nagging.
 *  - On recovery from any failure streak, a HIGH ntfy is sent so you know
 *    it fixed itself.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

import { runScrape } from './sources/ofcom-amateur/scrape';
import { runProcess } from './sources/ofcom-amateur/process';
import * as crypto from 'crypto';
import {
  logger,
  loadJsonFile,
  saveJsonFile,
  calculateFileHash,
  CONSTANTS,
  ProcessResult,
  ScrapeResult,
} from './shared/utils';

//
// State
//

const STATE_FILE = '.notify-state.json';

// Wall-clock schedule for Ofcom fetches. Local time on the running host - the
// systemd unit should live in Europe/London, or `timedatectl set-timezone`
// applied accordingly on the LXC.
//
// Slot selection rationale:
// - 03:00 catches overnight batch publications (Ofcom's automated end)
// - 10:00 catches early-morning manual publications, once staff are in
// - 14:00 catches late-morning-to-lunchtime publications (added 2026-07-06 to
//         halve the 10:00->18:00 gap; Ofcom publish manually during UK
//         business hours so the 10:00-18:00 window was the widest exposure)
// - 18:00 catches afternoon publications and end-of-day mop-up
const SCHEDULED_HHMM: string[] = ['03:00', '10:00', '14:00', '18:00'];

// Half-width of the "we're at a scheduled slot" window, in minutes. A wake-up
// at any point in [scheduled - WINDOW, scheduled + WINDOW] counts as being at
// that slot. Wider tolerates missed ticks; narrower avoids double-firing across
// slots. 15 min is comfortable for a 5-min-tick systemd timer.
const WINDOW_MIN = 15;

interface NotifyState {
  consecutiveFailures: number;
  lastErrorMessage?: string;
  lastErrorNotifiedAt?: string;
  lastSuccessAt?: string;
  // Which scheduled window did we most recently execute for? Format is
  // `${YYYY-MM-DD}T${HH:MM}`. Prevents multiple wake-ups within the same window
  // from all running the full pipeline.
  lastRunWindowId?: string;

  // Fields used by the ?v= verification path (added in a subsequent commit).
  // Present here so state-file evolution is single-source.
  lastKnownV?: string;
  lastKnownVContentHash?: string;
  lastKnownVVerifiedAt?: string;

  // Drift notifications: fingerprints identify a specific drift state so we
  // re-notify when it changes (new commits touched the units) but not for the
  // same state within 24h. Both fields clear when drift resolves.
  lastSystemdDriftNotifiedAt?: string;
  lastSystemdDriftFingerprint?: string;
  lastWorkingTreeDriftNotifiedAt?: string;
  lastWorkingTreeDriftFingerprint?: string;

  // Persistent git-operation failure notifications: same shape as drift
  // (fingerprint + timestamp), clears on next successful git op. Fires only
  // when a git op we EXPECTED to succeed actually failed - transient noise
  // is suppressed by the fingerprint / 24h rate limit.
  lastGitFailureNotifiedAt?: string;
  lastGitFailureFingerprint?: string;
  lastGitFailureMessage?: string;
}

async function loadState(): Promise<NotifyState> {
  const state = await loadJsonFile<NotifyState>(STATE_FILE);
  return state ?? { consecutiveFailures: 0 };
}

async function saveState(state: NotifyState): Promise<void> {
  await saveJsonFile(STATE_FILE, state);
}

//
// shouldRunNow - the whole schedule policy in one pure function.
//

interface RunDecision {
  action: 'run' | 'skip';
  reason: string;
  windowId?: string;
}

export function shouldRunNow(state: NotifyState, now: Date): RunDecision {
  for (const hhmm of SCHEDULED_HHMM) {
    const [h, m] = hhmm.split(':').map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(h, m, 0, 0);
    const diffMin = Math.abs(now.getTime() - scheduled.getTime()) / 60_000;
    if (diffMin > WINDOW_MIN) continue;

    const windowId = `${isoDate(now)}T${hhmm}`;
    if (state.lastRunWindowId === windowId) {
      return { action: 'skip', reason: `already ran in window ${windowId}` };
    }
    return {
      action: 'run',
      reason: `within ${WINDOW_MIN}min of scheduled ${hhmm} (window ${windowId})`,
      windowId,
    };
  }
  return { action: 'skip', reason: 'not within any scheduled window' };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

//
// Notifications - ntfy client, soft-fail
//

type NtfyPriority = 'low' | 'default' | 'high';

// ntfy.sh's priority header takes a numeric value 1..5. We use 2/3/4 for our
// three logical levels; 1 (min) and 5 (max) are reserved so we've got headroom
// if we ever need "so low it's silent" or "so high it bypasses do-not-disturb".
const NTFY_PRIORITY_HEADER: Record<NtfyPriority, string> = {
  low: '2',
  default: '3',
  high: '4',
};

async function ntfy(priority: NtfyPriority, title: string, body: string): Promise<void> {
  const url = process.env.NTFY_TOPIC_URL;
  if (!url) {
    logger.info(`[ntfy skipped - NTFY_TOPIC_URL not set] [${priority}] ${title}: ${body}`);
    return;
  }
  try {
    await axios.post(url, body, {
      headers: {
        'Title': title,
        'Priority': NTFY_PRIORITY_HEADER[priority],
      },
      timeout: 15_000,
    });
    logger.info(`ntfy sent: [${priority}] ${title}`);
  } catch (err: any) {
    // Deliberately do NOT propagate: a broken ntfy is not a broken mirror.
    logger.warn(`ntfy send failed (${err.message}); continuing.`);
  }
}

//
// Healthchecks (dead-man's-switch), soft-fail
//

async function healthchecksPing(): Promise<void> {
  const url = process.env.HEALTHCHECKS_PING_URL;
  if (!url) {
    logger.debug('healthchecks skipped (HEALTHCHECKS_PING_URL not set)');
    return;
  }
  try {
    await axios.get(url, { timeout: 15_000 });
    logger.debug('healthchecks ping sent');
  } catch (err: any) {
    logger.warn(`healthchecks ping failed (${err.message}); continuing.`);
  }
}

//
// Drift detection - flag two kinds of "the host is running something that
// doesn't match the repo" that CANNOT be auto-healed by the non-root runner:
//
// 1. Systemd unit drift: the deployed /etc/systemd/system/*.service files
//    differ from the docs/systemd/*.service files in the checkout. Needs
//    root to run `sudo bash docs/setup/update-service.sh` to reconcile.
//
// 2. Working-tree drift: local unstaged changes exist in the checkout that
//    aren't ours. Suggests something is editing files on the LXC by hand,
//    or the auto-pull's `--autostash` had to stash local mods before rebase
//    (rare but shouldn't happen in normal operation).
//
// Both are informational, LOW priority, rate-limited to at most one notify
// per 24h per distinct drift state.
//

const SYSTEMD_DEPLOYED_DIR = '/etc/systemd/system';
const SYSTEMD_UNIT_FILES = [
  'amateur-callsigns-mirror.service',
  'amateur-callsigns-mirror.timer',
  'amateur-callsigns-mirror-notify-failure.service',
];

interface DriftResult {
  drifted: boolean;
  fingerprint: string;   // stable identifier for this specific drift state
  summary: string;       // short human-readable description
}

// Compare the repo's docs/systemd/*.service files against the deployed copies
// under /etc/systemd/system/. Returns null on hosts where the check doesn't
// apply (Windows/macOS dev workstations, systems without systemd) - we don't
// want dev boxes to notify about drift they have no way to fix.
function detectSystemdDrift(): DriftResult | null {
  if (!fsSync.existsSync(SYSTEMD_DEPLOYED_DIR)) return null;

  const repoUnitsDir = path.resolve(__dirname, '..', 'docs', 'systemd');
  if (!fsSync.existsSync(repoUnitsDir)) return null;

  const changed: Array<{ name: string; repoHash: string }> = [];
  for (const name of SYSTEMD_UNIT_FILES) {
    const repoFile = path.join(repoUnitsDir, name);
    const deployedFile = path.join(SYSTEMD_DEPLOYED_DIR, name);
    if (!fsSync.existsSync(repoFile)) continue;         // not our unit yet
    if (!fsSync.existsSync(deployedFile)) {
      // File exists in repo but not deployed - drift (needs install)
      changed.push({ name, repoHash: calculateFileHash(repoFile) });
      continue;
    }
    const repoHash = calculateFileHash(repoFile);
    const deployedHash = calculateFileHash(deployedFile);
    if (repoHash !== deployedHash) changed.push({ name, repoHash });
  }

  if (changed.length === 0) {
    return { drifted: false, fingerprint: '', summary: '' };
  }

  const sorted = changed.sort((a, b) => a.name.localeCompare(b.name));
  const fingerprint = crypto
    .createHash('sha256')
    .update(sorted.map(x => `${x.name}:${x.repoHash}`).join('\n'))
    .digest('hex')
    .slice(0, 12);
  const summary = sorted.map(x => x.name).join(', ');
  return { drifted: true, fingerprint, summary };
}

// Detect any local unstaged changes in the checkout - things that would show
// as `M` under `git status`. In normal operation the runner only writes
// tracked files at controlled moments (archive/, latest-*, metadata sidecar),
// so persistent unstaged mods usually mean either someone edited on the LXC
// by hand OR the auto-pull's --autostash had to stash something before
// rebasing. Either way, worth a nudge.
function detectWorkingTreeDrift(): DriftResult | null {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (status.length === 0) return { drifted: false, fingerprint: '', summary: '' };

    // Look ONLY at unstaged mods and untracked files. Staged changes are
    // ours (about to be committed by gitCommitAndPush) so skip anything with
    // an index-side status letter.
    const lines = status.split('\n').filter(line => {
      // status --porcelain format: XY <path>; X = index status, Y = worktree.
      // We care about Y being non-space or lines starting with `??` (untracked).
      return line.startsWith('??') || (line.length >= 2 && line[1] !== ' ');
    });
    if (lines.length === 0) return { drifted: false, fingerprint: '', summary: '' };

    const fingerprint = crypto
      .createHash('sha256')
      .update(lines.sort().join('\n'))
      .digest('hex')
      .slice(0, 12);
    // Cap the summary in case a large number of files are in a bad state
    const summary = lines.slice(0, 5).map(l => l.trim()).join('; ') +
                    (lines.length > 5 ? ` ... (+${lines.length - 5} more)` : '');
    return { drifted: true, fingerprint, summary };
  } catch {
    // Not a git checkout, or git not available - no meaningful drift check.
    return null;
  }
}

// Handle a git operation outcome: if it failed, LOW-notify (rate-limited
// per fingerprint of the failure message) so persistent SSH / network / auth
// issues surface within a tick or two of manifesting. If it succeeded and
// we were previously in a failure state, clear the state - resolution is
// silent (no dedicated "recovered" ntfy for git; that pattern is reserved
// for the main mirror-failure escalation ladder).
async function handleGitOpOutcome(state: NotifyState, outcome: GitOpResult): Promise<void> {
  if (outcome.success) {
    if (state.lastGitFailureFingerprint) {
      logger.info('git operation recovered; clearing failure state.');
      state.lastGitFailureFingerprint = undefined;
      state.lastGitFailureNotifiedAt = undefined;
      state.lastGitFailureMessage = undefined;
    }
    return;
  }

  const message = outcome.message ?? '(no error message)';
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${outcome.op}\n${message}`)
    .digest('hex')
    .slice(0, 12);

  // Same decision shape as drift: notify if new fingerprint OR 24h has
  // passed since the last notify of this same fingerprint.
  const decision = shouldNotifyGitFailure(
    fingerprint,
    state.lastGitFailureFingerprint,
    state.lastGitFailureNotifiedAt,
    new Date(),
  );
  if (!decision.notify) {
    logger.debug(`git failure (${outcome.op}): ${decision.reason}`);
    return;
  }

  await ntfy(
    'low',
    `Git operation failing: ${outcome.op}`,
    `${message}. The runner continues with local state; investigate on the LXC ` +
    `(cd /opt/amateur-callsigns-file-watch && su -s /bin/bash - callsign-data-mirror -c "${outcome.op}").`,
  );
  state.lastGitFailureFingerprint = fingerprint;
  state.lastGitFailureNotifiedAt = new Date().toISOString();
  state.lastGitFailureMessage = message;
}

// Pure decision helper for git-failure notification rate-limiting.
// Symmetric to shouldNotifyDrift.
export function shouldNotifyGitFailure(
  currentFingerprint: string,
  lastFingerprint: string | undefined,
  lastNotifiedAt: string | undefined,
  now: Date,
): { notify: boolean; reason: string } {
  if (lastFingerprint !== currentFingerprint) {
    return { notify: true, reason: 'new or changed failure' };
  }
  if (!lastNotifiedAt) return { notify: true, reason: 'no prior notify recorded' };
  const hoursAgo = (now.getTime() - new Date(lastNotifiedAt).getTime()) / 3_600_000;
  if (hoursAgo >= 24) return { notify: true, reason: `${hoursAgo.toFixed(1)}h since last notify` };
  return { notify: false, reason: `same failure, notified ${hoursAgo.toFixed(1)}h ago (< 24h)` };
}

// Pure decision helper for drift-notification rate-limiting. Testable
// without any filesystem / systemd knowledge. Given the current drift
// state and the persisted last-notified state, decides whether to
// notify now.
export function shouldNotifyDrift(
  drift: DriftResult,
  lastFingerprint: string | undefined,
  lastNotifiedAt: string | undefined,
  now: Date,
): { notify: boolean; reason: string } {
  if (!drift.drifted) return { notify: false, reason: 'no drift' };
  if (lastFingerprint !== drift.fingerprint) {
    return { notify: true, reason: 'new or changed drift state' };
  }
  if (!lastNotifiedAt) return { notify: true, reason: 'no prior notify recorded' };
  const hoursAgo = (now.getTime() - new Date(lastNotifiedAt).getTime()) / 3_600_000;
  if (hoursAgo >= 24) return { notify: true, reason: `${hoursAgo.toFixed(1)}h since last notify` };
  return { notify: false, reason: `same drift, notified ${hoursAgo.toFixed(1)}h ago (< 24h)` };
}

// Fire a LOW notification when we hit new drift, or refresh a 24h-stale
// notify for the same drift state. Clear state fields when drift resolves.
async function handleDrift(
  state: NotifyState,
  drift: DriftResult | null,
  kind: 'systemd' | 'working-tree',
): Promise<void> {
  const [fpField, tsField, titlePrefix] = kind === 'systemd'
    ? ['lastSystemdDriftFingerprint', 'lastSystemdDriftNotifiedAt',
       'Systemd units on LXC differ from repo'] as const
    : ['lastWorkingTreeDriftFingerprint', 'lastWorkingTreeDriftNotifiedAt',
       'LXC has unstaged local changes'] as const;

  if (!drift) return;   // check doesn't apply on this host

  if (!drift.drifted) {
    // Resolution: clear state so next drift starts fresh
    if (state[fpField] || state[tsField]) {
      logger.info(`${kind} drift resolved; clearing state.`);
      state[fpField] = undefined;
      state[tsField] = undefined;
    }
    return;
  }

  const decision = shouldNotifyDrift(drift, state[fpField], state[tsField], new Date());
  if (!decision.notify) {
    logger.debug(`drift (${kind}): ${decision.reason}`);
    return;
  }

  const body = kind === 'systemd'
    ? `Files differ: ${drift.summary}. ` +
      `To reconcile, on the LXC as root: ` +
      `sudo bash /opt/amateur-callsigns-file-watch/docs/setup/update-service.sh`
    : `Working tree has unstaged changes: ${drift.summary}. ` +
      `Investigate on the LXC: cd /opt/amateur-callsigns-file-watch && ` +
      `su -s /bin/bash - callsign-data-mirror -c "git status"`;

  await ntfy('low', titlePrefix, body);
  state[fpField] = drift.fingerprint;
  state[tsField] = new Date().toISOString();
}

//
// Git operations - commit and push. Soft-fail on push (network flake shouldn't
// invalidate the tick), throws on commit failure (that IS a broken mirror).
//

interface GitResult {
  committed: boolean;
  pushed: boolean;
  pushError?: string;
  // Structured pull-rebase result so the tick can persist failure state
  // rather than only surfacing "still committed but push failed" as a
  // footnote in the update notification body.
  rebaseFailed?: boolean;
  rebaseError?: string;
}

// Result of a single git operation. `op` names the operation for
// human-readable notifications; `success` records whether the op did what we
// wanted. On failure, `message` carries the first line of git's stderr (or
// exception message) so downstream code can compose notifications and
// fingerprint the failure state.
interface GitOpResult {
  op: string;
  success: boolean;
  message?: string;
}

// Fast-forward pull at start of tick. Picks up any dev-pushed code changes
// (README, orchestrator logic, docs) so the LXC's copy stays current without
// manual `git pull` intervention. --ff-only means: never touch local commits
// (a data commit awaiting push counts) and never do a merge; only advance
// main if origin has moved and we have nothing local.
//
// Non-fatal by design: an unpushed local commit will cause this to fail
// cleanly, and we simply continue with local state. Returns a structured
// result so the caller can decide whether to notify - "no changes to pull"
// isn't a failure worth notifying about, but SSH auth errors are.
export function tryFastForwardPull(): GitOpResult {
  try {
    // Compare HEAD before and after so we can log "already up to date" vs
    // "fetched N commits" distinctly, without relying on git's stdout text.
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['pull', '--ff-only'], { stdio: 'pipe' });
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (before === after) {
      logger.info('git pull --ff-only: already up to date');
    } else {
      logger.info(`git pull --ff-only: advanced ${before.slice(0, 7)} -> ${after.slice(0, 7)}`);
    }
    return { op: 'git pull --ff-only', success: true };
  } catch (err: any) {
    const message = (err.stderr?.toString() || err.message || '').split('\n')[0].trim();
    logger.warn(`git pull --ff-only failed: ${message}`);
    return { op: 'git pull --ff-only', success: false, message };
  }
}

// Publications land on main via pull requests (issue #14): each new archive
// entry is pushed to its own data/* branch, and a scheduled sweep workflow
// opens the PR and enables auto-merge. The fetch host's credential therefore
// only ever needs to push branches - nothing it holds can write to main.
export function dataBranchName(archiveKey: string): string {
  return `data/${archiveKey}`;
}

export function gitCommitAndPush(message: string, archiveKey: string): GitResult {
  const result: GitResult = { committed: false, pushed: false };
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (status.length === 0) return result;

  // Stage explicitly: new archive entries and the latest-* pointer set, plus
  // the sidecar download-info metadata that scrape produces. We deliberately
  // do NOT `git add -A` to avoid accidentally committing anything else that
  // might have landed in the working tree.
  const F = CONSTANTS.FILES;
  const paths = [
    CONSTANTS.DIRS.archive,
    F.originalRawCsvFile, // legacy staging path, still tracked for continuity
    F.latestRawCsv,
    F.latestRawSortedCsv,
    F.latestJson,
    F.latestRawSortedJson,
    F.latestMeta,
    F.downloadMetadataFile,
  ];
  execFileSync('git', ['add', ...paths], { stdio: 'pipe' });

  const author = process.env.GIT_AUTHOR_NAME;
  const email = process.env.GIT_AUTHOR_EMAIL;
  const commitEnv: NodeJS.ProcessEnv = { ...process.env };
  if (author) commitEnv.GIT_AUTHOR_NAME = commitEnv.GIT_COMMITTER_NAME = author;
  if (email) commitEnv.GIT_AUTHOR_EMAIL = commitEnv.GIT_COMMITTER_EMAIL = email;

  execFileSync('git', ['commit', '-m', message], { stdio: 'pipe', env: commitEnv });

  result.committed = true;

  if (process.env.SKIP_PUSH === 'true') {
    logger.info('Push skipped (SKIP_PUSH=true set).');
    return result;
  }

  // Rebase our just-created data commit onto origin/main before pushing, so
  // the data branch is based on the freshest main. Handles the "dev pushed a
  // code commit between our last tick and now" race, and drops any of our
  // older local data commits that have since been merged. Since data commits
  // only touch archive/latest-* and dev commits typically touch
  // src/README/docs, conflicts are essentially never expected.
  // --autostash guards against transient dirty state (there shouldn't be any
  // at this point since we just committed, but cheap defence).
  try {
    execFileSync('git', ['pull', '--rebase', '--autostash'], { stdio: 'pipe' });
    logger.debug('git pull --rebase --autostash succeeded before push');
  } catch (err: any) {
    const errMsg = (err.stderr?.toString() || err.message || '').split('\n')[0].trim();
    logger.warn(`git pull --rebase failed (${errMsg}); attempting push anyway.`);
    result.rebaseFailed = true;
    result.rebaseError = errMsg;
    // Continue - if rebase failed AND origin has actually diverged, the push
    // will fail below and be surfaced via the normal push-error notification
    // path. If rebase failed for a transient network reason, the push might
    // still succeed.
  }

  // Push to a data/* branch, never to main. The commit stays on the local
  // main too, which keeps the next tick idempotent (the archive entry is
  // present, so process won't re-create it). Once the PR merges with a merge
  // commit, our local commit is one of the merge's parents, so the tick-start
  // `git pull --ff-only` converges without any divergence handling.
  try {
    execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${dataBranchName(archiveKey)}`], { stdio: 'pipe' });
    result.pushed = true;
    return result;
  } catch (err: any) {
    const errMsg = err.stderr?.toString() || err.message;
    logger.warn(`git push failed: ${errMsg}`);
    result.pushError = errMsg;
    return result;
  }
}

//
// Failure handling and escalation
//

async function handleFailure(state: NotifyState, err: Error): Promise<void> {
  state.consecutiveFailures += 1;
  state.lastErrorMessage = err.message;
  const failures = state.consecutiveFailures;

  const shouldNotifyAgain = (): boolean => {
    if (!state.lastErrorNotifiedAt) return true;
    const hoursAgo = (Date.now() - new Date(state.lastErrorNotifiedAt).getTime()) / 3_600_000;
    return hoursAgo >= 24;
  };

  if (failures === 1) {
    await ntfy('low', 'Ofcom mirror hiccup', `Transient failure: ${err.message}`);
    state.lastErrorNotifiedAt = new Date().toISOString();
  } else if (failures === 2) {
    await ntfy('default', 'Ofcom mirror still failing', `Second consecutive failure: ${err.message}`);
    state.lastErrorNotifiedAt = new Date().toISOString();
  } else if (failures === 3) {
    await ntfy('high', 'Ofcom mirror broken', `Third consecutive failure - needs intervention: ${err.message}`);
    state.lastErrorNotifiedAt = new Date().toISOString();
  } else if (shouldNotifyAgain()) {
    // Persistent failure beyond the escalation ladder - remind at most once/24h.
    await ntfy('high', 'Ofcom mirror still broken', `${failures} consecutive failures. Most recent: ${err.message}`);
    state.lastErrorNotifiedAt = new Date().toISOString();
  }
}

async function handleSuccess(state: NotifyState, result: ProcessResult, git: GitResult): Promise<void> {
  const previouslyFailingCount = state.consecutiveFailures;
  state.consecutiveFailures = 0;
  state.lastSuccessAt = new Date().toISOString();

  if (previouslyFailingCount > 0) {
    await ntfy('high', 'Ofcom mirror recovered',
      `Back online after ${previouslyFailingCount} consecutive failure${previouslyFailingCount === 1 ? '' : 's'}.`);
  }

  if (result.wasNewArchiveEntry) {
    const body = composeUpdateBody(result, git);
    await ntfy('high', `Ofcom callsigns updated (${result.ofcomReportedUpdate ?? result.archiveKey})`, body);
  }
}

function composeUpdateBody(result: ProcessResult, git: GitResult): string {
  const lines: string[] = [];
  lines.push(`Archive key: ${result.archiveKey}`);
  lines.push(`Records: ${result.recordCount.toLocaleString('en-GB')}`);
  const d = result.diffSummary;
  if (d && d.previousArchiveKey) {
    lines.push(`Diff vs ${d.previousArchiveKey}: ${d.added ?? 0} added, ${d.removed ?? 0} removed, ${d.fieldChanged ?? 0} field-changed`);
    if (d.sampleAdded && d.sampleAdded.length > 0) lines.push(`Added examples: ${d.sampleAdded.join(', ')}`);
    if (d.sampleRemoved && d.sampleRemoved.length > 0) lines.push(`Removed examples: ${d.sampleRemoved.join(', ')}`);
  }
  if (!git.pushed && git.committed) {
    lines.push(`(Committed locally but push failed${git.pushError ? `: ${git.pushError}` : ''}.)`);
  }
  return lines.join('\n');
}

//
// The tick itself
//

async function runTick(state: NotifyState, windowId: string): Promise<void> {
  const scrape = await runScrape({
    lastKnownV: state.lastKnownV,
    lastKnownVContentHash: state.lastKnownVContentHash,
    lastKnownVVerifiedAt: state.lastKnownVVerifiedAt,
  });
  logger.info(`Scrape action: ${scrape.action}`);

  // Anomaly: Ofcom republished under an unchanged ?v=. The staging file was
  // NOT overwritten, so process would just re-observe the previous good CSV.
  // Notify HIGH and record verifiedAt = now (so we don't burn a full download
  // re-verifying at the next tick), then bail out of the tick without
  // touching git or invoking process.
  if (scrape.action === 'anomaly-detected') {
    await ntfy('high', 'Ofcom cache-buster anomaly',
      scrape.anomalyMessage ?? 'Ofcom republished content under an unchanged ?v= - manual review needed.');
    state.lastKnownVVerifiedAt = new Date().toISOString();
    state.lastRunWindowId = windowId;
    return;
  }

  const result = await runProcess();

  let git: GitResult = { committed: false, pushed: false };
  if (result.wasNewArchiveEntry) {
    const commitMessage = buildCommitMessage(result);
    git = gitCommitAndPush(commitMessage, result.archiveKey);
    logger.info(`git commit=${git.committed} push=${git.pushed} branch=${dataBranchName(result.archiveKey)}`);

    // Feed the git-op outcomes into the same failure-notification path as
    // the tick-start fast-forward pull. Order matters: report rebase before
    // push, because a rebase failure typically causes the subsequent push
    // failure, and we want the ROOT-CAUSE notification to be the sticky one.
    if (git.rebaseFailed) {
      await handleGitOpOutcome(state, {
        op: 'git pull --rebase --autostash',
        success: false,
        message: git.rebaseError,
      });
    }
    if (!git.pushed && git.committed) {
      await handleGitOpOutcome(state, {
        op: 'git push',
        success: false,
        message: git.pushError,
      });
    } else if (git.pushed) {
      // Successful push clears any lingering push-failure state
      await handleGitOpOutcome(state, { op: 'git push', success: true });
    }
  } else {
    logger.info('No new archive entry - skipping git commit/push.');
  }

  await handleSuccess(state, result, git);
  updateVersionState(state, scrape);
  state.lastRunWindowId = windowId;
}

// Fold the scrape outcome back into the persisted state so the next tick can
// take the fast-path when appropriate. Only fresh downloads bump lastKnownV
// and its hash; verification-passes only bump the verifiedAt timestamp.
function updateVersionState(state: NotifyState, scrape: ScrapeResult): void {
  const now = new Date().toISOString();
  if (scrape.action === 'downloaded' && scrape.currentV && scrape.contentHash) {
    state.lastKnownV = scrape.currentV;
    state.lastKnownVContentHash = scrape.contentHash;
    state.lastKnownVVerifiedAt = now;
  } else if (scrape.action === 'verified-unchanged') {
    state.lastKnownVVerifiedAt = now;
  }
  // 'fast-path-skipped' and 'anomaly-detected' leave lastKnownV state alone
  // (fast-path had no reason to update it; anomaly is handled above and does
  // its own timestamp bump so we don't loop on re-verifying).
}

function buildCommitMessage(result: ProcessResult): string {
  const dateStr = result.ofcomReportedUpdate ?? result.archiveKey;
  const parts = [`Update amateur callsigns CSV (Ofcom updated: ${dateStr})`];
  const d = result.diffSummary;
  if (d && d.previousArchiveKey && (d.added || d.removed || d.fieldChanged)) {
    parts.push('');
    parts.push(`vs archive/${d.previousArchiveKey}/: ${d.added ?? 0} added, ${d.removed ?? 0} removed, ${d.fieldChanged ?? 0} field-changed`);
  }
  return parts.join('\n');
}

//
// Entry point
//

async function main(): Promise<void> {
  const state = await loadState();
  const now = new Date();
  const decision = shouldRunNow(state, now);

  // Fast-forward pull on EVERY tick (including skips) - not only when work
  // is being done. Otherwise dev-pushed code changes only reach the LXC
  // when a scheduled window happens to fall after the push, which could be
  // hours or (over a weekend) days. Cheap; safe (--ff-only touches no
  // local commits).
  const pullOutcome = tryFastForwardPull();
  await handleGitOpOutcome(state, pullOutcome);

  // Drift checks run on EVERY tick (including skips) because they're the
  // signal that "the host is running a version of the systemd config that
  // doesn't match what's in the repo any more". Cheap - a couple of file
  // hashes and one `git status`. Rate-limited internally per drift state
  // so this doesn't spam. Runs AFTER the fast-forward pull so we're
  // comparing the freshly-pulled repo state against the deployed state.
  try {
    await handleDrift(state, detectSystemdDrift(), 'systemd');
    await handleDrift(state, detectWorkingTreeDrift(), 'working-tree');
  } catch (err: any) {
    logger.warn(`drift check failed (${err.message}); continuing.`);
  }

  if (decision.action === 'skip') {
    logger.debug(`Not running this tick: ${decision.reason}`);
    // Even on a skipped tick we heartbeat healthchecks. That way healthchecks
    // treats "the LXC is up and running the timer, just not scheduled to
    // fetch right now" as alive. If we ONLY pinged on real work ticks,
    // healthchecks would think the mirror was dead outside the 3 slots/day.
    await healthchecksPing();
    await saveState(state);
    return;
  }

  logger.info(`Running this tick: ${decision.reason}`);

  try {
    await runTick(state, decision.windowId!);
    // Healthy tick: heartbeat. Note we deliberately do NOT ping on a failure -
    // absence of pings is a signal healthchecks can use for its own alert.
    await healthchecksPing();
  } catch (err: any) {
    await handleFailure(state, err instanceof Error ? err : new Error(String(err)));
    // NOTE: do not re-throw; the tick has done its job (notify on failure).
    // Exit code 0 keeps systemd's `Result=success` clean; the state file is
    // the authoritative record of what happened.
  } finally {
    await saveState(state);
  }
}

if (require.main === module) {
  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled Rejection at:', reason);
    process.exit(1);
  });

  main().catch((err: Error) => {
    logger.error(`Scheduled-run failed at top level: ${err.message}`, err);
    process.exit(1);
  });
}
