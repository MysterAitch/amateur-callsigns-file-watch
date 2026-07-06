# amateur-callsigns-file-watch

Mirrors Ofcom's [amateur radio callsign](https://www.ofcom.org.uk/about-ofcom/our-research/opendata) publications to git as they update, so the commit history is a durable record of what got published and when.

The project has three logical pieces:

- **Scrape**: fetch Ofcom's opendata index, locate the current amateur CSV link (its filename rotates with a `?v=` cache-buster), download the CSV to a temp path, and content-validate it before promoting into place. Includes a `?v=` fast-path that skips the ~11 MB download when the cache-buster hasn't changed, with periodic re-verification. See [`src/sources/ofcom-amateur/scrape.ts`](src/sources/ofcom-amateur/scrape.ts).
- **Process**: parse the raw CSV, compute the sorted view (for git-diff readability), compute a semantic diff against the previous archive entry, and materialise a new `archive/{ofcom-date}/` directory with `raw.csv` + `meta.json`. Also refreshes the repo-root `latest-*` pointers. Includes a record-count regression guard that refuses to archive suspiciously-shrunken publications. See [`src/sources/ofcom-amateur/process.ts`](src/sources/ofcom-amateur/process.ts).
- **Scheduled orchestrator**: the entry point a periodic timer invokes. Decides whether to run scrape+process this tick (schedule policy lives in code), commits and pushes any new archive entry, and sends notifications. Soft-fails all external services. See [`src/scheduled-run.ts`](src/scheduled-run.ts).

## Repository layout

```
archive/                            <- authoritative record; one directory per Ofcom publication
  {ofcom-date}/                        e.g. 2026-06-23/
    raw.csv                         <- Ofcom's bytes, untouched
    meta.json                       <- provenance + shape + diff summary
latest-raw.csv                      <- convenience pointers: newest archive entry's raw
latest-raw-sorted.csv                  ...raw content, sorted for git-diff readability
latest.json                            ...raw content as JSON (raw order)
latest-raw-sorted.json                 ...raw content as JSON (sorted)
latest-meta.json                       ...the newest entry's meta
src/
  scheduled-run.ts                  <- Pattern-2 orchestrator; the systemd timer's ExecStart
  shared/                           <- source-agnostic archive, utils, types
  sources/{key}/                    <- one directory per data source; ofcom-amateur is the first
docs/systemd/                       <- unit templates for LXC deployment
```

Consumers can either:

- **Walk `archive/`** as ordinary files — no git required — for the full history.
- **Read `latest-*` at repo root** for just the current dataset.

## Development

Requires Node 26+.

```bash
npm ci                              # strict install from lock; use after `git pull`
npm test                            # unit tests (vitest)

# run individual pipeline steps against the live Ofcom site (residential IP required):
npm run pull                        # scrape + download
npm run process                     # transform + archive
```

The network fetch **only works from a residential IP** — Cloudflare blocks datacenter ASNs from the Ofcom opendata page, so GitHub-hosted runners and cloud VMs will get a challenge page instead of the CSV. This is why the scheduled runner is deployed to a homelab LXC (or similar), not to CI.

The scheduled orchestrator can be run manually from any machine (Windows / macOS / Linux) with an empty `.env` — it will do local work and log-skip notifications and git push:

```bash
npm run scheduled                   # one tick; decides whether to actually do anything
```

### Cross-platform lock-file discipline

`package-lock.json` is checked in and honoured on both Windows and Linux. Modern npm (v7+) stores platform-conditional optional dependencies (e.g. `@emnapi/*` on Linux) with `os`/`cpu` constraints; both platforms' entries can coexist in one lock. To keep it that way:

- **After `git pull`, use `npm ci`** — installs strictly from the lock, never writes to it.
- **Use `npm install` only when you intend to modify the lock** — adding a dep, running `npm audit fix`, or (on first install after cloning to a new platform) reconciling platform-specific optional deps.

Treating `npm ci` as read-only and `npm install` as a modifying operation prevents cross-platform lock drift.

### Line-ending preservation

`.gitattributes` marks `archive/**/raw.*`, `latest-raw.*`, and `amateur-callsigns-raw.csv` as `binary`. This preserves Ofcom's original bytes (CRLF-terminated CSVs) verbatim across platforms — the archive idempotence check depends on `sha256` of the raw file matching between the live download and the checked-out archive. Derived files (sorted CSVs, JSONs, `meta.json`) are deliberately left as text, because Node's writers emit `\n` line endings unconditionally on every OS and text handling gives better git-diff readability.

## Automation

The orchestrator is designed to be invoked frequently by a boring, always-on timer (every 5 minutes by default). A pure decision function `shouldRunNow(state, now)` inside the orchestrator decides whether that particular tick actually touches Ofcom. Current policy: 4× per day at 03:00, 10:00, 14:00, 18:00 local, with a ±15-min window and per-window deduplication. **All schedule policy lives in code, in `src/scheduled-run.ts`.** The systemd timer is just "wake me up every 5 minutes; forget everything else."

### Prerequisites

- **A residential connection**. Cloudflare will block a datacenter IP.
- **A Debian 13 (trixie) LXC** (or equivalent always-on host) on the residential side. Recipes below assume Debian on Proxmox.
- **A write-scoped SSH deploy key** on the GitHub repo (see below).
- **Optional but recommended**: an [ntfy.sh](https://ntfy.sh) topic (free, no signup) for update/failure notifications, a [Healthchecks.io](https://healthchecks.io) check (free tier) for a dead-man's-switch alert when the LXC itself goes silent, or self-hosted equivalents ([Uptime Kuma](https://github.com/louislam/uptime-kuma) is the common self-hosted replacement for both).

### 1. Provision the LXC (Proxmox click-ops)

| Setting | Value | Notes |
|---|---|---|
| Template | Debian 13 (trixie) | Node 26 install path assumes this |
| CPU | 1 core | plenty |
| RAM | **2 GB** | 512 MB is not enough — the CSV parse + jsdom peak is ~1 GB |
| Swap | 1 GB | headroom |
| Disk | 4 GB | archive growth is ~130 MB/year |
| Unprivileged | ✓ | default; keep it |
| **Nesting** | **✓** | required for Debian 13's systemd 257 to fully honour the service unit's hardening directives |
| Network | static IP | e.g. matching the container ID as the last octet (`/24`, not `/32`) |
| SSH public key | pasted at creation | avoids the "root password SSH is disabled by default" tangent |

### 2. Basic system setup (inside the LXC as root)

```bash
apt update && apt upgrade -y
apt install -y curl git ca-certificates gnupg nano

# Timezone - so 03:00 / 10:00 / 18:00 slots honour BST/GMT automatically
timedatectl set-timezone Europe/London

# Node 26 from NodeSource - Debian 13's default repos ship Node 20/22
curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
apt install -y nodejs
node --version                                # want v26.x.x

# Dedicated non-privileged service user with home dir but no interactive login
useradd --system --create-home --home-dir /home/callsign-data-mirror \
        --shell /usr/sbin/nologin callsign-data-mirror
```

### 3. Deploy key + git config

```bash
# Generate the keypair AS the service user, so ownership is correct from the start
runuser -u callsign-data-mirror -- ssh-keygen -t ed25519 -N '' \
    -C "deploy: amateur-radio-data-mirror LXC ($(date +%Y-%m-%d))" \
    -f /home/callsign-data-mirror/.ssh/id_ed25519

# SSH client config: force this specific key for github.com,
# auto-accept github's host key on first connect (no interactive prompt)
cat > /home/callsign-data-mirror/.ssh/config <<'CFG'
Host github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
CFG
chown callsign-data-mirror:callsign-data-mirror /home/callsign-data-mirror/.ssh/config
chmod 600 /home/callsign-data-mirror/.ssh/config

# Default git commit identity (the .env can override at runtime later)
runuser -u callsign-data-mirror -- git config --global user.name  "callsign-data-mirror"
runuser -u callsign-data-mirror -- git config --global user.email "callsign-data-mirror@amateur-radio-data-mirror"

# Print the public key for pasting to GitHub
cat /home/callsign-data-mirror/.ssh/id_ed25519.pub
```

**Then in the browser**:

1. GitHub → your repo → Settings → Deploy keys → **Add deploy key**
2. Title: something like `amateur-radio-data-mirror LXC`
3. Paste the printed `ssh-ed25519 …` line
4. **Check "Allow write access"** — critical, otherwise push fails silently
5. Add

**Verify from the LXC** (should print `Hi <your-user>/<your-repo>! You've successfully authenticated…`):

```bash
runuser -u callsign-data-mirror -- ssh -T git@github.com
```

The first invocation adds github.com to the mirror user's `~/.ssh/known_hosts`; subsequent non-interactive git operations won't prompt.

### 4. Clone the repo

```bash
mkdir -p /opt/amateur-callsigns-file-watch
chown callsign-data-mirror:callsign-data-mirror /opt/amateur-callsigns-file-watch

runuser -u callsign-data-mirror -- git clone \
    git@github.com:YOUR-GH-USER/amateur-callsigns-file-watch.git \
    /opt/amateur-callsigns-file-watch

cd /opt/amateur-callsigns-file-watch
runuser -u callsign-data-mirror -- npm install
runuser -u callsign-data-mirror -- npm test   # 49 tests pass
```

`npm install` on the first-run (not `npm ci`) so platform-specific optional deps (Linux-only `@emnapi/*` etc.) get added to `package-lock.json`. Commit that change back so future `npm ci` works on both platforms:

```bash
su -s /bin/bash - callsign-data-mirror -c '
    cd /opt/amateur-callsigns-file-watch
    git add package-lock.json
    git commit -m "Update lock file with Linux-only optional deps"
    git push
'
```

### 5. Populate `.env`

Two shapes — heredoc, or copy the template and edit:

```bash
# Option A: direct heredoc
runuser -u callsign-data-mirror -- bash -c "cat > /opt/amateur-callsigns-file-watch/.env <<'EOF'
NTFY_TOPIC_URL=https://ntfy.sh/YOUR-LONG-RANDOM-HEX
HEALTHCHECKS_PING_URL=https://hc-ping.com/YOUR-UUID
EOF"
chmod 600 /opt/amateur-callsigns-file-watch/.env

# Option B: template + nano
runuser -u callsign-data-mirror -- cp /opt/amateur-callsigns-file-watch/.env.example \
                                       /opt/amateur-callsigns-file-watch/.env
chmod 600 /opt/amateur-callsigns-file-watch/.env
nano /opt/amateur-callsigns-file-watch/.env
```

See `.env.example` in the repo for what each variable does. Everything is optional at runtime — missing variables produce soft-fail log messages, not crashes.

### 6. Manual smoke test

Interactive shell as the service user (`su` needs `-s /bin/bash` to override the `nologin` shell):

```bash
su -s /bin/bash - callsign-data-mirror
cd /opt/amateur-callsigns-file-watch
DEBUG=true npm run scheduled
```

Outside a scheduled slot, expected output:

```
[DEBUG] Not running this tick: not within any scheduled window
[DEBUG] healthchecks ping sent               (or "skipped" if not configured)
```

Confirm the ping landed by refreshing the check's page in Healthchecks — should show "received a ping just now". Exit back to root with `exit` or Ctrl-D.

### 7. Install (and later update) systemd units

Use the bundled bootstrap script, which is idempotent — safe to run repeatedly. It only copies units that actually differ, only reloads systemd if something changed, only restarts the timer if a unit file changed, and verifies units via `systemd-analyze verify` before finishing:

```bash
# First install (script auto-enables timer)
sudo bash /opt/amateur-callsigns-file-watch/docs/setup/update-service.sh

# All subsequent unit-file changes:
sudo bash /opt/amateur-callsigns-file-watch/docs/setup/update-service.sh
```

The script also drops down to the service user for the initial `git pull`, so root's git state stays clean of the "dubious ownership" warning that would otherwise fire on a user-owned repo.

Watch fires live:

```bash
journalctl -u 'amateur-callsigns-mirror*' -f
```

Every 5 minutes you should see either a "not within any scheduled window" skip (with a healthchecks ping) or, at 03/10/14/18, an actual scrape → process → git ops → notification sequence.

### Notifications

Priorities used by the orchestrator:

- **HIGH** (priority 4): new publication landed; runner recovered from a failure streak; runner has failed 3 consecutive times; ongoing failure re-notify (rate-limited to 24h); systemd-level failure (via the `OnFailure=` sibling unit — catches transpiler-startup crashes and hangs that the runner cannot notify itself about).
- **DEFAULT** (priority 3): second consecutive failure.
- **LOW** (priority 2): first consecutive failure (transient blip); systemd unit drift (repo units differ from deployed); working-tree drift (unstaged changes); persistent git operation failure (pull, rebase, push).

Drift and git-failure notifications are fingerprinted and rate-limited to at most one per 24h per unique state, and clear automatically when the underlying issue resolves.

Notifications are a *separate* stream from any noisy alerting you already have (e.g. Telegram bots, HA notifications for door sensors). A long random ntfy topic name = effectively a private channel.

The Healthchecks ping fires on every non-error tick, including scheduled skips — so absence of pings for more than the check's period + grace is a signal that the LXC itself is dead / unreachable, which the local runner cannot notify about because it isn't running.

### Alternative hosts

- **Docker on a compose host (e.g. dockge)** instead of an LXC: replace the systemd timer with an [ofelia](https://github.com/mcuadros/ofelia) sidecar container in the compose file, invoking `npm run scheduled` on the same `*/5` cadence. Everything else is identical.
- **Cross-platform runner**: the runner script itself is host-agnostic — same code works on Linux, macOS, and Windows. Only the "run me every 5 minutes" wrapper changes.

## Non-goals and open items

- **Cross-publication normalisation** (mapping Ofcom's shifting column schema — `Value__c` vs `Callsign` vs the BOM-contaminated `﻿Callsign` — to a canonical shape) is a future piece of work.
- **Building presentation on top** (SPA / SQLite dump / GitHub Pages) is deliberately not this repo's job — this repo's single responsibility is being the authoritative archive. Downstream repos consume it.
- **Post-fetch processing location** (quality reports, PDF/XLSX extraction, normalisation into a canonical schema) — where this runs (same repo via scoped GHA, downstream repo, or on the LXC) is REOPENED pending a fresh design conversation. The LXC's minimal-downloader role stays fixed either way.
- **Additional sources** (FOI datasets, `data.gov.uk`, other Ofcom sections) will land under `src/sources/{key}/` when the multi-source refactor happens.

### Backlog

Open work items are tracked as [GitHub Issues](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues) rather than in-repo files. Use the labels `enhancement`, `refactor`, `research`, `docs`, `discussion` to distinguish work types.

## Design notes

Selected rationale worth knowing before making changes:

- **Archive shape**: `archive/{ofcom-date}/raw.csv` + `meta.json` per publication. The sorted CSV lives only at `latest-raw-sorted.csv`, not per publication — inside `archive/`, sort variants have no git-diff value (each entry is a fresh directory on commit).
- **Sort key**: currently the first column of the raw CSV, which happens to be the callsign column in every historical publication. If Ofcom ever moves the callsign out of column 1, `latest-raw-sorted.csv` will silently become semantically inconsistent — a future normalisation-aware sort will fix this.
- **Diff summary in `meta.json`** is a *snapshot at write time*. If publications are ever retroactively inserted between existing entries, older `meta.json` files are NOT rewritten. Consumers needing an authoritative up-to-date diff should re-derive from the raw CSVs.
- **Sanity gates are load-bearing**: HTML/challenge-page detection (in scrape), header-token check (in scrape), record-count regression check (in process, refuses commits where the current publication has less than 50% of the previous record count), and the archive-key `?v=` verification anomaly path — all exist because Ofcom has historically published truncated / broken datasets and silently mirroring them would be worse than an honest crash.
- **Raw-bytes preservation**: `.gitattributes` marks raw source files as `binary` so their exact bytes survive checkout on any platform. The archive idempotence check hashes the staging CSV against archived `raw.csv` hashes; line-ending normalisation would break that invariant.

## Licence

MIT.
