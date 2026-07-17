# amateur-callsigns-file-watch

A durable archive of UK amateur radio callsign data, in two lanes:

- **Open-data lane** (`archive/{date}/`): mirrors Ofcom's [amateur radio callsign](https://www.ofcom.org.uk/about-ofcom/our-research/opendata) publications to git as they update, so the commit history is a durable record of what got published and when.
- **FOI lane** (`archive/foi/{entry}/`, [ADR 0004](docs/adr/0004-foi-source-lane.md)): a decade of FOI-disclosed material (register snapshots, available lists, issuance events, statistics, and responses that are records rather than datasets), one reviewed entry per request/publication with full provenance, hash-pinned files and — where a dataset exists — deterministic converters into published per-class schemas.

What exists per dataset is tracked in the generated [`docs/dataset-status.md`](docs/dataset-status.md); whether every derivation still verifies is the [rolling coverage dashboard](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/360); sources not yet ingested are tracked in [`docs/source-register.md`](docs/source-register.md). The architecture is recorded as decision records — see the [ADR index](docs/adr/README.md).

> **Direction of travel — the canonical-record model is being inverted.** [ADR 0013](docs/adr/0013-raw-keyed-claim-ledger.md) (accepted; strangler migration in progress) makes a **raw-keyed claim ledger** the canonical record, from which the normalised CSVs, query databases, reports and Pages site all become *derived folds*. The snapshot-canonical pipeline described below is the current baseline being migrated onto ledger folds, not a retired one: it keeps running until each projection is reproduced against its golden master.

The project's logical pieces:

- **Scrape**: fetch Ofcom's opendata index, locate the current amateur CSV link (its filename rotates with a `?v=` cache-buster), download the CSV to a temp path, and content-validate it before promoting into place. Includes a `?v=` fast-path that skips the ~11 MB download when the cache-buster hasn't changed, with periodic re-verification. See [`src/sources/ofcom-amateur/scrape.ts`](src/sources/ofcom-amateur/scrape.ts).
- **Process**: parse the raw CSV, compute the sorted view (for git-diff readability), compute a semantic diff against the previous archive entry, and materialise a new `archive/{ofcom-open-data-date}/` directory with `raw.csv` + `meta.json`. Also refreshes the repo-root `latest-*` pointers. Includes a record-count regression guard that refuses to archive suspiciously-shrunken publications. See [`src/sources/ofcom-amateur/process.ts`](src/sources/ofcom-amateur/process.ts).
- **Scheduled orchestrator**: the entry point a periodic timer invokes. Decides whether to run scrape+process this tick (schedule policy lives in code), commits any new archive entry and pushes it to a `data/*` branch, and sends notifications. Soft-fails all external services. See [`src/scheduled-run.ts`](src/scheduled-run.ts).
- **Data sweep** ([ADR 0009](docs/adr/0009-data-landing-via-branches-and-sweep.md)): a scheduled GitHub Actions workflow that discovers pushed `data/*` branches, opens a pull request for each, and enables auto-merge (merge-commit) when the diff is confined to data paths. Nothing lands on `main` without a PR; the fetch host's deploy key can only push branches. See [`.github/workflows/data-sweep.yml`](.github/workflows/data-sweep.yml).
- **Read-only CI**: every PR must pass `tests` (typecheck + unit tests) and `data-validation` — for the open-data lane: archive-entry completeness, size + sha256 byte integrity against each entry's `meta.json`, CSV parseability, latest-pointer consistency; for the FOI lane: meta shape and vocabularies, referential integrity (converter bindings, derivation references, entry cross-links) and the same full byte integrity (every declared file hash-verified on every run). Also runnable locally via `npm run validate:data`. Both are required status checks on `main`, so the sweep's auto-merge only completes on green. See [`.github/workflows/cicd.yaml`](.github/workflows/cicd.yaml), [`src/ci/validate-foi.ts`](src/ci/validate-foi.ts), and [ADR 0002](docs/adr/0002-repo-level-write-controls.md) for the repository-level write controls this slots into (and [ADR 0012](docs/adr/0012-supply-chain-posture.md) for the read-only, minimal-dependency posture CI holds to). The verification and Pages deploy now share one pipeline with a layered, content-addressed build cache — see [ADR 0019](docs/adr/0019-layered-build-cache-and-unified-cicd.md).
- **Canonical schema, folded from the ledger**: every consumer reads each publication's derived views (`normalised.csv`, `components.csv`, `stats.json`) — one canonical schema (stable columns, ISO-ordered dates) regardless of Ofcom's per-publication header drift — through a single switch: the committed copies under `archive/{key}/` are a frozen equivalence baseline, and the same bytes fold from the raw-keyed claim ledger at build time (proven byte-identical, entry by entry, by a full-corpus parity gate). A new publication needs no derivation step at all: its authored header binding is detected from its own header row and its derived views exist in the ledger projection the moment it lands. Authored binding registry: [`src/sources/ofcom-amateur/normalise.ts`](src/sources/ofcom-amateur/normalise.ts); projection: [`src/v2/build-builder-projection.ts`](src/v2/build-builder-projection.ts).
- **Report sweep**: a daily workflow regenerates the committed standing reports under [`reports/`](reports/) from the ledger projection. Byte-identical output is a no-op; changes become an always-human-reviewed PR whose cross-report diff is the review artefact (golden-master semantics, ADR 0001). Coverage (per-entry derived-view state) lives on a rolling dashboard issue. Sweep: [`src/ci/report-sweep.ts`](src/ci/report-sweep.ts) (`npm run reports:sweep`).
- **FOI derivation chain**: raw disclosure files → mechanical extraction (`src/shared/xlsx-extract.ts`, a dependency-free workbook reader; PDF tables are transcribed into committed `raw-extract-*.md` files) → deterministic converters (`src/shared/foi-normalise.ts`, authored per-entry bindings in each `meta.json`) → `normalised--*.csv` in the published per-class schemas ([`docs/foi-schemas.md`](docs/foi-schemas.md)). Every arrow is re-derived and byte-compared on every CI run: per-entry golden-master tests plus a whole-lane verification over every FOI entry (`src/ci/foi-verification.ts`, issue #447 - the retired daily sweep converted to a per-PR gate).
- **Presentation** ([ADR 0003](docs/adr/0003-in-repo-presentation-poc.md)): every push to `main` builds a SQLite database from the archive + reference data and deploys it with a frameworkless lookup site ([`site/`](site/)) to [GitHub Pages](https://mysteraitch.github.io/amateur-callsigns-file-watch/) — callsign lookup with regional-variant resolution, an instant per-callsign page answered from prefix-sharded static JSON (no database on that path), filtered browse, suffix availability and RSL matrices, per-publication data-quality flags, per-class dataset index pages (clickable class tags), a fidelity and integrity deep-dive, and a dedicated forbidden-suffix section (an index, one page per forbidden-list disclosure, and one per ever-forbidden suffix with notable-change drill-downs). Shared page-render helpers (nav, breadcrumb, page shell, design tokens) live in [`src/ci/site-render.ts`](src/ci/site-render.ts) so every generated section reads as one product.

## Repository layout

```
archive/                            <- authoritative record (the archive contract: ADR 0010)
  {ofcom-open-data-date}/              open-data lane: one directory per Ofcom publication
    raw.csv                         <- Ofcom's bytes, untouched
    meta.json                       <- provenance + shape + diff summary
    normalised.csv, components.csv  <- derived (golden-master lane)
  foi/{entry}/                         FOI lane (ADR 0004): one directory per request/publication
    meta.json                       <- provenance, outcome, hash-pinned file declarations
    correspondence.md               <- the publication/exchange record (always present)
    <data files verbatim>           <- xlsx/csv/pdf as disclosed (where a dataset exists)
    raw-extract-*.{csv,md}          <- mechanical workbook extracts / PDF transcriptions
    normalised--*.csv               <- converter outputs in the published per-class schemas
latest-raw.csv                      <- convenience pointers: newest open-data entry's raw
latest-raw-sorted.csv                  ...raw content, sorted for git-diff readability
latest.json                            ...raw content as JSON (raw order)
latest-raw-sorted.json                 ...raw content as JSON (sorted)
latest-meta.json                       ...the newest entry's meta
reference-data/                     <- hand-curated reference tables (RSLs, prefix formats, ITU series...)
reports/                            <- generated golden-master reports (value catalogue, drill-downs); published at /reports/
site/                               <- the GitHub Pages site (ADR 0003): lookup, instant per-callsign page, statistics, explore, compare, series, datasets (+ per-class pages), forbidden suffixes, fidelity/integrity, reports, glossary, about
src/
  scheduled-run.ts                  <- Pattern-2 orchestrator; the systemd timer's ExecStart
  shared/                           <- source-agnostic archive, utils, FOI converters + extractor
  sources/{key}/                    <- one directory per data source; ofcom-amateur is the first
  ci/                               <- validation, sweeps, generated-doc builders, SQLite build
  v2/                               <- raw-keyed claim ledger (ADR 0013): claim model, collectors/ registry (one module per source family), JSONL build, query-artefact + report folds
docs/
  adr/                              <- architecture decision records (see adr/README.md for the index)
  dataset-status.md                 <- generated per-dataset overview (freshness-tested)
  foi-schemas.md                    <- generated FOI schema registry (freshness-tested)
  normalised-schema.md              <- open-data normalised schema reference
  source-register.md                <- cross-lane index of known sources and their intake status
  systemd/                          <- unit templates for LXC deployment
```

Consumers can either:

- **Walk `archive/`** as ordinary files — no git required — for the full history.
- **Read `latest-*` at repo root** for just the current dataset.

## Development

Requires Node 26+. A devcontainer ([`.devcontainer/`](.devcontainer/devcontainer.json), `node:26-bookworm`) provides a Linux environment matching CI and the deployment host — use it for cross-platform lock-file reconciliation (see below) and CI-equivalent test runs. The Ofcom scrape won't work from cloud-hosted containers (datacenter IP).

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

### Serving the built site locally

`_site/` (the Pages build output — see the CI/CD workflow's `build-site-databases`
and `Assemble the site` steps) is never committed, so there is no way to
browser-load a real page without a local static server. `npm run serve:site`
is a small committed one (`src/tools/serve-site.ts`, node:http + node:fs only —
no new dependency): fixed default port (`4600`, overridable via a `SITE_PORT`
env var or a positional argument), correct MIME types for everything the site
ships — including the `.sqlite.png` costume the range-served SQLite databases
wear so GitHub Pages never gzip-transcodes them (`site/app.js`) — and HTTP
Range support (206 partial content) so sql.js-httpvfs can query a database
without downloading it whole. Directory URLs (`/foo/`) resolve to that
directory's `index.html`.

```bash
npm run serve:site                  # serves _site/ at http://localhost:4600/
SITE_PORT=5000 npm run serve:site   # or: node src/tools/serve-site.ts 5000
```

A fixed default port means a browser's "allow this origin" permission only
needs granting once, rather than for a fresh ephemeral port every run.

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
| **Start at boot** | **✓** | NOT the Proxmox default — without it the container (and the dead-man's-switch pings) stays down after a host reboot until started by hand; on an existing container: Options → Start at boot, or `pct set <vmid> --onboot 1` |
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
runuser -u callsign-data-mirror -- npm test   # unit tests pass
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

## Settled design questions and open items

Earlier revisions of this README listed several of these as non-goals or open questions; they have since been settled by ADRs and built:

- **Canonical-record model** — accepted, migration in progress ([ADR 0013](docs/adr/0013-raw-keyed-claim-ledger.md)): the record is being inverted to a raw-keyed claim ledger with every other artefact (normalised CSV, query databases, reports, pages) a derived fold over it (tracker [#361](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/361)). The snapshot-canonical items below are the current baseline being strangler-migrated onto ledger folds, retired per projection only once it reproduces its golden master.
- **Cross-publication normalisation** — built (ADR 0001/ADR 0013): one canonical schema across every open-data publication, folded from the claim ledger (the committed copies stay as the frozen equivalence baseline); the FOI lane's converters do the same per dataset class ([`docs/foi-schemas.md`](docs/foi-schemas.md)).
- **Presentation** — built in-repo (ADR 0003): the SQLite database + lookup site deploy to GitHub Pages on every push to `main`.
- **Post-fetch processing location** — settled (ADR 0001, and the two-tier split recorded in [ADR 0011](docs/adr/0011-two-tier-architecture.md)): in this repo, via scheduled workflows whose only write path is opening PRs. The LXC remains a minimal downloader.
- **FOI datasets** — built as the second archive lane (ADR 0004), 25+ entries and counting.
- **Canonical callsign forms** — the `cleaned` / `placeholder_form` join keys (ADR 0005) unify publisher artefacts and regional renderings without claiming identity.
- **Publishing the dataset files + per-callsign FOI observations** (#149) — built: the Pages build publishes every archived entry's raw/extract/normalised files at stable URLs with Frictionless descriptors and a sitemap, and the lookup shows a callsign's FOI-witnessed history alongside the register.
- **Standing reports + value catalogue as site pages** (#229/#51) — built: `/reports/` publishes the sweep-regenerated drill-downs and a cross-lane value catalogue (every tracked value with counts, per-source breadth, a per-publication timeline, and a record/callsign/allocated count breakdown), plus a licence-category normalisation (`reference-data/licence-category.csv`). A per-PR golden-master freshness gate (#243) keeps them from drifting.
- **Forbidden-suffix section** (#291) — built: the December 2024 forbidden list is ingested (`archive/foi/ofcom-2024-12--forbidden-suffixes`) alongside the 2016 and 2019 disclosures, `reports/forbidden-suffix-history.md` derives the diff/observation layer, the ever-forbidden union (1,466 suffixes) and each suffix's first-known-forbidden date, and the Pages build publishes a first-class site section: an index, one page per forbidden-list disclosure, one page per union suffix, and the notable-change drill-downs. The row-level `forbidden-suffix` flag now keys off the union, and a new `forbidden-suffix-issued-after-first-known-list` flag keys per-suffix on the first-known-forbidden date.
- **Dataset-class pages** (#178) — built: one static page per dataset class listing every open-data and FOI entry that carries it, with the class chips on entry pages and the dataset index linking through.
- **Accessibility + navigation** — every page carries a skip link and `<main>` landmark, scoped data-table headers, a uniform nav with breadcrumbs on deep pages, and a plain-language glossary + About page.
- **Offline-first / PWA** — built (ADR 0008, #248): a service worker precaches the static shell so the site works offline, plus a user-triggered full-dataset download that caches the SQLite database and answers queries with no network.

Proposed (recorded, awaiting ratification):

- **Reusable UI modules via Web Components** rather than a framework (ADR 0006).
- **Migrating the coverage dashboard to a published site page** with a lightweight workflow alarm (ADR 0007).

Still open:

- **Cross-dataset invariant probes** (overlap/complementarity/depletion/original-start-date, joined on `cleaned`) as a committed report — [#241](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/241): three of the five probes (depletion, still-absent decomposition, original-start-date) are published at `/reports/cross-dataset-invariants`; the overlap matrix and same-vintage complementarity probes remain (the latter blocked on a matched-vintage register snapshot). The raw-vs-normalised value-gap layer ([#242](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/242)) is built.
- **Restructuring `archive/` into per-source lanes** (`archive/open-data/{key}/` alongside `archive/foi/{key}/`) — tracked in [#151](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/151), LXC-coordinated.
- **Further sources** (Business Radio Light, `data.gov.uk` WTR dump) — see [`docs/source-register.md`](docs/source-register.md).

### Backlog

Open work items are tracked as [GitHub Issues](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues) rather than in-repo files. Use the labels `enhancement`, `refactor`, `research`, `docs`, `discussion` to distinguish work types. Data PRs additionally carry a separate, automatically-applied dataset-class label axis — see [CONTRIBUTING.md](CONTRIBUTING.md#dataset-class-labels).

## Design notes

Selected rationale worth knowing before making changes:

- **Archive shape**: `archive/{ofcom-open-data-date}/raw.csv` + `meta.json` per publication. The sorted CSV lives only at `latest-raw-sorted.csv`, not per publication — inside `archive/`, sort variants have no git-diff value (each entry is a fresh directory on commit).
- **Sort key**: currently the first column of the raw CSV, which happens to be the callsign column in every historical publication. If Ofcom ever moves the callsign out of column 1, `latest-raw-sorted.csv` will silently become semantically inconsistent — a future normalisation-aware sort will fix this.
- **Diff summary in `meta.json`** is a *snapshot at write time*. If publications are ever retroactively inserted between existing entries, older `meta.json` files are NOT rewritten. Consumers needing an authoritative up-to-date diff should re-derive from the raw CSVs.
- **Sanity gates are load-bearing**: HTML/challenge-page detection (in scrape), header-token check (in scrape), record-count regression check (in process, refuses commits where the current publication has less than 50% of the previous record count), and the archive-key `?v=` verification anomaly path — all exist because Ofcom has historically published truncated / broken datasets and silently mirroring them would be worse than an honest crash.
- **Raw-bytes preservation**: `.gitattributes` marks raw source files as `binary` so their exact bytes survive checkout on any platform. The archive idempotence check hashes the staging CSV against archived `raw.csv` hashes; line-ending normalisation would break that invariant.

## Licence

Code and data carry different terms, so the licensing is split by scope:

| Scope | Licence |
| --- | --- |
| This repository's code and original documentation | [MIT](LICENSE) |
| `archive/` (mirrored publisher data) | Not MIT — each publisher's own terms, recorded per publisher and per entry rather than restated here; see [`archive/LICENSE.md`](archive/LICENSE.md) |

[`reference-data/publishers.json`](reference-data/publishers.json) is the register of verified per-publisher terms; the site's [About page](https://mysteraitch.github.io/amateur-callsigns-file-watch/about.html) carries an acknowledgement derived from it, so it cannot drift out of step with the register.
