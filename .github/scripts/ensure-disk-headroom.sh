#!/usr/bin/env bash
# Guarantee a job enough disk to finish, WITHOUT paying to reclaim space it
# already has, and without silently betting on runners being over-provisioned.
#
# THE TENSION THIS RESOLVES. GitHub documents a standard runner as having
# 14 GB of SSD space. Observed on ubuntu-latest during this repo's heaviest job
# (2026-07-28): 145 GB total, 85.8 GB free before any reclaim. The documented
# figure is the CONTRACT; the observed figure is merely today's weather, and
# actual availability is not promised to be stable. Building on the observation
# alone is a bet that the contract will keep being exceeded.
#
# The heaviest regeneration consumes 12.9 GB at peak - the claim-ledger JSONL
# intermediate. Against the observed 85.8 GB that is 15%; against the DOCUMENTED
# 14 GB it is 92%. Both readings are real, and a step that unconditionally
# deletes ~20 GB of preinstalled toolchains costs 75-85 s every run to insure
# against the second.
#
# So: measure, act only if needed, and fail LOUDLY rather than mid-run. On a
# generously provisioned runner this costs one `df`. On a runner provisioned to
# spec it reclaims what it can and, if that is still not enough, stops with a
# diagnosable message instead of an ENOSPC from whichever write happened to be
# unlucky - a corrupt or truncated artefact is worse than no artefact.
#
# NEEDED_GB - what the job must be able to write (caller supplies; no default,
# because a wrong guess here is exactly the failure mode this exists to prevent).
# MARGIN_GB - headroom above NEEDED_GB before reclaiming (default 12).
set -euo pipefail

needed="${NEEDED_GB:?NEEDED_GB must be set - the caller knows its own peak write volume}"
margin="${MARGIN_GB:-12}"
threshold=$((needed + margin))

avail_gb() { df -Pk / | awk 'NR==2{printf "%d", $4/1048576}'; }

before=$(avail_gb)
echo "disk: ${before} GB free; job needs ${needed} GB, reclaim threshold ${threshold} GB"

if [ "$before" -ge "$threshold" ]; then
  echo "disk: sufficient headroom - skipping the reclaim (saves 75-85 s)"
  exit 0
fi

echo "disk: below threshold - reclaiming preinstalled toolchains this job never uses"
# Each path guarded so a future image that drops one is not a failure.
sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/lib/android "${AGENT_TOOLSDIRECTORY:-/opt/hostedtoolcache}" || true

after=$(avail_gb)
echo "disk: ${before} GB -> ${after} GB free"

if [ "$after" -lt "$needed" ]; then
  echo "::error::Insufficient disk after reclaim: ${after} GB free, job needs ${needed} GB. This runner is provisioned closer to the documented 14 GB than the ~145 GB usually seen. Shrink the write volume (the claim-ledger JSONL intermediate is the largest single writer - see issue #997) rather than reclaiming harder."
  df -h /
  exit 1
fi

echo "disk: reclaim sufficient"
