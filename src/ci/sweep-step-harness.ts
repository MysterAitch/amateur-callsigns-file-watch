import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// What the executed-step tests of the scheduled sweeps share: lifting a step's
// script out of its workflow file, and a stand-in `gh` that answers from a
// state directory and records every call. Each test file builds its own
// temporary repositories, because what a sweep finds there is its scenario.
//
// The stand-in evaluates `--jq` with the real jq, and the scripts are bash, so
// these tests run on Linux (CI) and are skipped on Windows, where neither is a
// given. On Linux a missing bash or jq is a failure, not a skip.

export const RUNS_HERE = process.platform !== 'win32';
export const PR_URL = 'https://github.test/example/repo/pull/7';
export const FOREIGN_PR_URL = 'https://github.test/example/repo/pull/66';

interface WorkflowShape {
  jobs: Record<string, { steps: Array<{ name?: string; run?: string }> } | undefined>;
}

export function stepScript(workflowPath: string, job: string, stepName: string): string {
  const wf = yaml.load(fs.readFileSync(workflowPath, 'utf8')) as WorkflowShape;
  const step = wf.jobs[job]?.steps.find((s) => s.name === stepName);
  if (step?.run === undefined) throw new Error(`step "${stepName}" not found in job "${job}" of ${workflowPath}`);
  return step.run;
}

export function requireBashAndJq(): void {
  for (const tool of ['bash', 'jq']) {
    const probe = spawnSync(tool, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(`${tool} is required to execute a sweep step and was not found`);
  }
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

// Answers from files in $GH_STUB_DIR and appends each call to calls.log, one
// line per call whatever the arguments hold (a pull request body has newlines).
//   pr.json                      what `gh pr list` returns (a JSON array)
//   tip                          the commit a pull request created here points at
//   create-fails-after-creating  `pr create` creates the pull request, then exits 1
//   create-fails                 `pr create` exits 1 and creates nothing
//   merge-fails                  `pr merge` exits 1
// A created pull request takes its head branch name from `--head`. A listing
// returns the first 30 entries unless `--limit` says otherwise, as the real
// one does - a lookup that filters afterwards misses anything past that.
const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
line="$*"
printf '%s\\n' "\${line//$'\\n'/ }" >> "$GH_STUB_DIR/calls.log"
jq_expr=""
head_name=""
limit=30
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  if [ "\${args[i]}" = "--jq" ]; then jq_expr="\${args[i + 1]}"; fi
  if [ "\${args[i]}" = "--head" ]; then head_name="\${args[i + 1]}"; fi
  if [ "\${args[i]}" = "--limit" ]; then limit="\${args[i + 1]}"; fi
done
emit() { if [ -n "$jq_expr" ]; then jq -r "$jq_expr"; else cat; fi; }
case "$1 $2" in
  "pr list") jq -c --argjson n "$limit" '.[0:$n]' "$GH_STUB_DIR/pr.json" | emit ;;
  "pr create")
    if [ -f "$GH_STUB_DIR/create-fails" ]; then echo "pull request create failed" >&2; exit 1; fi
    jq -c --arg head "$head_name" --arg tip "$(cat "$GH_STUB_DIR/tip" 2>/dev/null || true)" \\
      '. + [{number: 7, url: "${PR_URL}", isCrossRepository: false, headRefName: $head, headRefOid: $tip, autoMergeRequest: null, assignees: [], comments: []}]' \\
      "$GH_STUB_DIR/pr.json" > "$GH_STUB_DIR/pr.json.next"
    mv "$GH_STUB_DIR/pr.json.next" "$GH_STUB_DIR/pr.json"
    if [ -f "$GH_STUB_DIR/create-fails-after-creating" ]; then
      echo "pull request create failed: HTTP 502: 502 Bad Gateway" >&2
      exit 1
    fi
    echo "${PR_URL}"
    ;;
  "pr merge") if [ -f "$GH_STUB_DIR/merge-fails" ]; then exit 1; fi ;;
  "pr edit" | "pr comment" | "issue comment" | "workflow run") ;;
  "issue list") echo '[{"number":5,"title":"Data landings (rolling digest)"}]' | emit ;;
  "issue create") echo "https://github.test/example/repo/issues/5" ;;
  "api repos/example/repo") echo '{"owner":{"login":"the-owner"}}' | emit ;;
  *) echo "gh stand-in: unexpected call: $*" >&2; exit 97 ;;
esac
`;

export interface OpenPullRequest {
  autoMerge?: boolean;
  assignees?: string[];
  comments?: string[];
  // Someone else's branch of the same name, which a lookup by head name
  // also returns.
  fromAFork?: boolean;
  headName?: string;
  head: string;
}

export class GhStandIn {
  readonly binDir: string;
  readonly stateDir: string;

  constructor(root: string) {
    this.stateDir = path.join(root, 'gh-state');
    this.binDir = path.join(root, 'bin');
    fs.mkdirSync(this.stateDir);
    fs.writeFileSync(path.join(this.stateDir, 'pr.json'), '[]\n');
    fs.writeFileSync(path.join(this.stateDir, 'calls.log'), '');
    fs.mkdirSync(this.binDir);
    fs.writeFileSync(path.join(this.binDir, 'gh'), GH_STUB, { mode: 0o755 });
  }

  // The environment a step needs to reach this stand-in in place of `gh`.
  env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: `${this.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      GH_STUB_DIR: this.stateDir,
      GITHUB_REPOSITORY: 'example/repo',
    };
  }

  setTip(commit: string): void {
    fs.writeFileSync(path.join(this.stateDir, 'tip'), commit);
  }

  tip(): string {
    return fs.readFileSync(path.join(this.stateDir, 'tip'), 'utf8');
  }

  // The same pull request, listed after `newerCount` unrelated open ones.
  openPullRequestBehind(newerCount: number, fields: OpenPullRequest): void {
    const newer = Array.from({ length: newerCount }, (_, i) => ({
      number: 100 + i,
      url: `https://github.test/example/repo/pull/${100 + i}`,
      isCrossRepository: false,
      headRefName: `feature/unrelated-${i}`,
      headRefOid: 'b'.repeat(40),
      autoMergeRequest: null,
      assignees: [{ login: 'someone' }],
      comments: [],
    }));
    fs.writeFileSync(path.join(this.stateDir, 'pr.json'), `${JSON.stringify([...newer, this.listed(fields)])}\n`);
  }

  openPullRequest(fields: OpenPullRequest): void {
    fs.writeFileSync(path.join(this.stateDir, 'pr.json'), `${JSON.stringify([this.listed(fields)])}\n`);
  }

  // A pull request as a listing reports it.
  private listed(fields: OpenPullRequest): Record<string, unknown> {
    return {
      number: fields.fromAFork === true ? 66 : 7,
      url: fields.fromAFork === true ? FOREIGN_PR_URL : PR_URL,
      isCrossRepository: fields.fromAFork === true,
      headRefName: fields.headName ?? '',
      headRefOid: fields.head,
      autoMergeRequest: fields.autoMerge === true ? { mergeMethod: 'MERGE' } : null,
      assignees: (fields.assignees ?? []).map((login) => ({ login })),
      comments: (fields.comments ?? []).map((body) => ({ body })),
    };
  }

  flag(name: string): void {
    fs.writeFileSync(path.join(this.stateDir, name), '');
  }

  callLines(): string[] {
    return fs.readFileSync(path.join(this.stateDir, 'calls.log'), 'utf8').split('\n').filter((line) => line.length > 0);
  }

  // The first two words of each recorded call, in order: what the step did.
  calls(): string[] {
    return this.callLines().map((line) => line.split(' ').slice(0, 2).join(' '));
  }

  // Recorded calls that were given this pull request as a whole argument.
  callsNaming(prUrl: string): string[] {
    return this.callLines().filter((line) => line.split(' ').some((argument) => argument === prUrl));
  }
}
