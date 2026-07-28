#!/usr/bin/env bash
# Post-mortem capture for a regeneration (issue #991). Runs on FAILURE as well
# as success — the failure case is the one it exists for — and is shared by the
# golden-master job and the stress matrix so the two cannot drift apart.
#
# Deliberately NOT `set -e`: every probe is best-effort, and a post-mortem that
# aborts halfway is how evidence gets lost.
set -uo pipefail

dir="${DIAGNOSTICS_DIR:-.diagnostics}"
mkdir -p "$dir"

# Stop the sampler if one is running, so the TSV is complete and closed.
if [ -f "$dir/sampler.pid" ]; then kill "$(cat "$dir/sampler.pid")" 2>/dev/null || true; fi

{
  echo "== final meminfo =="; cat /proc/meminfo
  echo "== final disk =="; df -h
  echo "== temp dir usage =="; du -sh "${RUNNER_TEMP:-/tmp}"/* 2>/dev/null | sort -rh | head -30
  echo "== workspace usage =="; du -sh ./* 2>/dev/null | sort -rh | head -30
  echo "== surviving processes =="; ps -eo pid,ppid,rss,pcpu,stat,etime,comm --sort=-rss | head -40
  echo "== OOM-KILLER EVIDENCE =="
  # The single most decisive line. A 'Killed process' record means the memory
  # budget is the answer and no further guessing is needed; its ABSENCE is
  # equally informative, so the negative is recorded explicitly rather than
  # left as an empty section that reads like a gap.
  sudo dmesg -T 2>/dev/null | grep -iE "out of memory|killed process|oom-kill|oom_reaper" || echo "(no OOM-killer records in dmesg)"
  echo "== dmesg tail =="; sudo dmesg -T 2>/dev/null | tail -60 || echo "(dmesg unavailable)"
  echo "== sampler stderr =="; cat "$dir/sampler-errors.txt" 2>/dev/null || echo "(none)"
} > "$dir/post-mortem.txt" 2>&1

# Surface the headlines in the job log too, so the common case needs no
# artifact download at all.
echo "---- OOM evidence ----"
grep -A2 "OOM-KILLER EVIDENCE" "$dir/post-mortem.txt" || true
echo "---- peak fold RSS (from /usr/bin/time -v, if enabled) ----"
grep -h "Maximum resident set size" "$dir"/rusage-*.txt 2>/dev/null | sort -t: -k2 -rn | head -10 || echo "(rusage capture not enabled)"
echo "---- last trace events ----"
tail -25 "$dir/sweep-trace.jsonl" 2>/dev/null || echo "(no sweep trace written)"
echo "---- resource samples (last 20) ----"
tail -20 "$dir/resource-samples.tsv" 2>/dev/null || echo "(no samples written)"
