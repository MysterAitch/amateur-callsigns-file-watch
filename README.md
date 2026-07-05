# amateur-callsigns-file-watch

Mirrors Ofcom's [amateur radio callsign](https://www.ofcom.org.uk/about-ofcom/our-research/opendata) publications to git as they update, so the commit history is a durable record of what got published and when.

The project has three logical pieces:

- **Scrape**: fetch Ofcom's opendata index, locate the current amateur CSV link (its filename rotates with a `?v=` cache-buster), download the CSV to a temp path, and content-validate it before promoting into place. See [`src/scrape-and-download.ts`](src/scrape-and-download.ts).
- **Process**: parse the raw CSV, compute the sorted view (for git-diff readability), compute a semantic diff against the previous archive entry, and materialise a new `archive/{ofcom-date}/` directory with `raw.csv` + `meta.json`. Also refreshes the repo-root `latest-*` pointers. See [`src/process-csv.ts`](src/process-csv.ts).
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
src/                                <- all TypeScript
docs/systemd/                       <- unit templates for LXC deployment
```

Consumers can either:

- **Walk `archive/`** as ordinary files — no git required — for the full history.
- **Read `latest-*` at repo root** for just the current dataset.

## Development

Requires Node 24+.

```bash
npm ci
npm test                # unit tests (vitest)

# run individual pipeline steps against the live Ofcom site (residential IP required):
npm run pull            # scrape + download
npm run process         # transform + archive
```

The network fetch **only works from a residential IP** — Cloudflare blocks datacenter ASNs from the Ofcom opendata page, so GitHub-hosted runners and cloud VMs will get a challenge page instead of the CSV. This is why the scheduled runner is deployed to a homelab LXC (or similar), not to CI.

The scheduled orchestrator can be run manually from any machine (Windows / macOS / Linux) with an empty `.env` — it will do local work and log-skip notifications and git push:

```bash
npm run scheduled       # one tick; decides whether to actually do anything
```

## Automation

The orchestrator is designed to be invoked frequently by a boring, always-on timer (every 5 minutes by default). A pure decision function `shouldRunNow(state, now)` inside the orchestrator decides whether that particular tick actually touches Ofcom. Current policy: 3× per day at 03:00, 10:00, 18:00 local, with a ±15-min window and per-window deduplication. **All schedule policy lives in code, in `src/scheduled-run.ts`.** The systemd timer is just "wake me up every 5 minutes; forget everything else."

### Prerequisites

- **A residential connection**. Cloudflare will block a datacenter IP.
- **A Debian LXC (or equivalent always-on host)** on the residential side. Recipes below assume Debian on Proxmox with a bind-mount or shared filesystem holding the checkout.
- **A write-scoped SSH deploy key** on the GitHub repo (see below).
- **Optional**: an [ntfy.sh](https://ntfy.sh) topic (free, no signup), a [Healthchecks.io](https://healthchecks.io) check (free tier), or self-hosted equivalents ([Uptime Kuma](https://github.com/louislam/uptime-kuma) is the common self-hosted replacement for both).

### 1. Provision the LXC

```bash
# On the Proxmox host: create a small Debian LXC. 512 MB RAM is plenty.
# Inside the LXC:
apt update
apt install -y nodejs npm git curl
timedatectl set-timezone Europe/London       # so 03/10/18 slots honour BST/GMT
useradd -r -s /usr/sbin/nologin ofcommirror  # dedicated non-privileged user
```

### 2. Clone the repo

```bash
mkdir -p /opt/amateur-callsigns-file-watch
chown ofcommirror:ofcommirror /opt/amateur-callsigns-file-watch
sudo -u ofcommirror bash <<'EOF'
cd /opt/amateur-callsigns-file-watch
git clone git@github.com:YOUR_GITHUB_USER/amateur-callsigns-file-watch.git .
npm ci
EOF
```

### 3. Generate and register a deploy key

```bash
sudo -u ofcommirror ssh-keygen -t ed25519 -N '' -C 'amateur-callsigns-mirror' \
    -f /home/ofcommirror/.ssh/deploy_key

cat /home/ofcommirror/.ssh/deploy_key.pub
```

On GitHub: repo → Settings → Deploy Keys → **Add deploy key** → paste the public key → **check "Allow write access"** → Add.

Tell git on the LXC to use this key for pushes:

```bash
sudo -u ofcommirror bash <<'EOF'
cat >> /home/ofcommirror/.ssh/config <<'CFG'
Host github.com
  User git
  IdentityFile ~/.ssh/deploy_key
  IdentitiesOnly yes
CFG
chmod 600 /home/ofcommirror/.ssh/config
cd /opt/amateur-callsigns-file-watch
git remote set-url origin git@github.com:YOUR_GITHUB_USER/amateur-callsigns-file-watch.git
EOF
```

### 4. Populate `.env`

Copy the example and fill in the service URLs you actually want:

```bash
sudo -u ofcommirror cp /opt/amateur-callsigns-file-watch/.env.example \
                     /opt/amateur-callsigns-file-watch/.env
sudo -u ofcommirror nano /opt/amateur-callsigns-file-watch/.env
```

See `.env.example` for what each variable does and what happens when unset.

### 5. Manual smoke test

```bash
sudo -u ofcommirror bash -c '
    cd /opt/amateur-callsigns-file-watch
    npm run scheduled
'
```

Outside a scheduled slot, you should see:

```
[DEBUG] Not running this tick: not within any scheduled window
```

To force a live run for testing, temporarily edit `SCHEDULED_HHMM` in `src/scheduled-run.ts` (or set your clock forward), then revert. Or just wait for the next 03/10/18 slot.

### 6. Install the systemd unit + timer

Templates are in `docs/systemd/`. Copy them into place, editing paths if you cloned somewhere other than `/opt/amateur-callsigns-file-watch`:

```bash
cp docs/systemd/amateur-callsigns-mirror.service /etc/systemd/system/
cp docs/systemd/amateur-callsigns-mirror.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now amateur-callsigns-mirror.timer
systemctl list-timers amateur-callsigns-mirror.timer
```

Check journal after a few minutes to see it firing:

```bash
journalctl -u amateur-callsigns-mirror.service -n 100 --no-pager
```

Every 5 minutes you should see either a "not within any scheduled window" skip or, at 03/10/18, a real run.

### Notifications

Priorities used by the orchestrator:

- **HIGH** (priority 4): new publication landed; runner recovered from a failure streak; runner has failed 3 consecutive times; ongoing failure re-notify (rate-limited to 24h).
- **DEFAULT** (priority 3): second consecutive failure.
- **LOW** (priority 2): first consecutive failure (transient blip).

Notifications are a *separate* stream from any noisy alerting you already have on the LXC (e.g. Telegram bots, HA notifications for door sensors, etc.). Long random ntfy topic name = effectively a private channel.

The Healthchecks ping fires on every successful tick, including scheduled skips — so absence of pings for more than ~1 day is a signal that the LXC itself is dead / unreachable, which the local runner cannot notify about because it isn't running.

### Alternative hosts

- **Docker on a compose host (e.g. dockge)** instead of an LXC: replace the systemd timer with an [ofelia](https://github.com/mcuadros/ofelia) sidecar container in the compose file, invoking `npm run scheduled` on the same `*/5` cadence. Everything else is identical.
- **Cross-platform**: the runner script itself is host-agnostic — same code works on Linux, macOS, and Windows. Only the "run me every 5 minutes" wrapper changes.

## Non-goals and open items

- **Cross-publication normalisation** (mapping Ofcom's shifting column schema — `Value__c` vs `Callsign` vs the BOM-contaminated `﻿Callsign` — to a canonical shape) is a future piece of work. See project memory (`.claude/`) for the plan.
- **`?v=` verification path**: the runner currently always downloads at each scheduled slot even if the URL's `?v=` version parameter hasn't changed. A follow-up will add a fast-path that skips download when v is unchanged, with periodic re-verification to catch anomalies. Backlogged.
- **Building presentation on top** (SPA / SQLite dump / GitHub Pages) is deliberately not this repo's job — this repo's single responsibility is being the authoritative archive. Downstream repos consume it.

## Design notes

Selected rationale worth knowing before making changes:

- **Archive shape**: `archive/{ofcom-date}/raw.csv` + `meta.json` per publication. The sorted CSV lives only at `latest-raw-sorted.csv`, not per publication — inside `archive/`, sort variants have no git-diff value (each entry is a fresh directory on commit).
- **Sort key**: currently the first column of the raw CSV, which happens to be the callsign column in every historical publication. If Ofcom ever moves the callsign out of column 1, `latest-raw-sorted.csv` will silently become semantically inconsistent — a future normalisation-aware sort will fix this.
- **Diff summary in `meta.json`** is a *snapshot at write time*. If publications are ever retroactively inserted between existing entries, older `meta.json` files are NOT rewritten. Consumers needing an authoritative up-to-date diff should re-derive from the raw CSVs.
- **Sanity gates are load-bearing**: HTML/challenge-page detection (in scrape), record-count regression check (in process, refuses commits where the current publication has less than 50% of the previous record count) — both exist because Ofcom has historically published truncated / broken datasets and silently mirroring them would be worse than an honest crash.

## Licence

MIT.
