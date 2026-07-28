#!/usr/bin/env bash
# Stream one resource sample every SAMPLE_INTERVAL seconds (default 2) as TSV on
# stdout, until killed. Used by the golden-master job and by the regeneration
# stress matrix (issue #991), so the two cannot drift apart.
#
# Streamed rather than summarised at the end: the trajectory INTO a failure is
# the evidence, and a process that is killed never gets to write a summary.
#
# KNOWN LIMIT, deliberately accepted here and covered elsewhere: sampling at a
# fixed interval CANNOT see a spike that begins and ends between two samples.
# True peak RSS per process comes from `/usr/bin/time -v` around the child
# itself (FOLD_RUSAGE=1), not from this file.
set -uo pipefail

interval="${SAMPLE_INTERVAL:-2}"

printf 'ts\tmem_total_kb\tmem_free_kb\tmem_available_kb\tswap_free_kb\tdirty_kb\tload1\tprocs_duckdb\trss_duckdb_kb\trss_node_kb\tdisk_root_avail_kb\tdisk_tmp_avail_kb\n'

while true; do
  ts=$(date +%s)
  mt=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
  mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
  ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
  sf=$(awk '/^SwapFree:/{print $2}' /proc/meminfo)
  dt=$(awk '/^Dirty:/{print $2}' /proc/meminfo)
  l1=$(awk '{print $1}' /proc/loadavg)
  # `pgrep -c` PRINTS 0 and EXITS NON-ZERO when nothing matches, so a `|| echo 0`
  # fallback appends a SECOND value and splits the row across two lines. Take the
  # first line and default an empty result instead.
  nd=$(pgrep -c duckdb 2>/dev/null | head -1); nd=${nd:-0}
  rd=$(ps -eo rss,comm 2>/dev/null | awk '$2 ~ /duckdb/ {s+=$1} END{print s+0}')
  rn=$(ps -eo rss,comm 2>/dev/null | awk '$2 ~ /node/ {s+=$1} END{print s+0}')
  dr=$(df -Pk / | awk 'NR==2{print $4}')
  dp=$(df -Pk "${RUNNER_TEMP:-/tmp}" | awk 'NR==2{print $4}')
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$ts" "$mt" "$mf" "$ma" "$sf" "$dt" "$l1" "$nd" "$rd" "$rn" "$dr" "$dp"
  sleep "$interval"
done
