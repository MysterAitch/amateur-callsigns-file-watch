#!/usr/bin/env bash
#
# Update the deployed amateur-callsigns-file-watch service on this host.
#
# Runs as root (needs to write to /etc/systemd/system/ and manage systemd),
# but drops to the service user for anything that touches the git checkout
# so ownership stays consistent and root doesn't develop opinions about
# the repo (the "dubious ownership" complaint git raises otherwise).
#
# Idempotent: safe to run repeatedly; only copies unit files and restarts
# systemd if something actually changed. Fails loudly with a clear message
# if any step goes wrong, rather than pressing on.
#
# Invoke:
#     sudo bash /opt/amateur-callsigns-file-watch/docs/setup/update-service.sh
#

set -euo pipefail

# ----- Configuration --------------------------------------------------------
# Assumptions match the README's deployment recipe. If a future host uses
# different paths / user, override via environment variables before invoking.
REPO_DIR="${REPO_DIR:-/opt/amateur-callsigns-file-watch}"
SERVICE_USER="${SERVICE_USER:-callsign-data-mirror}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
TIMER_UNIT="${TIMER_UNIT:-amateur-callsigns-mirror.timer}"
MAIN_UNIT="${MAIN_UNIT:-amateur-callsigns-mirror.service}"
NOTIFY_UNIT="${NOTIFY_UNIT:-amateur-callsigns-mirror-notify-failure.service}"

# ----- Preflight ------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: must run as root (needs to write to $SYSTEMD_DIR and manage systemd)" >&2
    exit 1
fi

if [[ ! -d "$REPO_DIR/.git" ]]; then
    echo "ERROR: $REPO_DIR is not a git checkout - has the initial deploy been done?" >&2
    exit 1
fi

if ! id "$SERVICE_USER" &>/dev/null; then
    echo "ERROR: service user '$SERVICE_USER' does not exist" >&2
    exit 1
fi

# ----- Helpers --------------------------------------------------------------
# Run a command as the service user, in the repo directory.
run_as_service_user() {
    runuser -u "$SERVICE_USER" -- bash -c "cd '$REPO_DIR' && $*"
}

# True iff the source file differs from the deployed file (or the deployed
# file is missing). Uses cmp so this covers both content and existence.
file_needs_update() {
    local src="$1" dst="$2"
    ! cmp --quiet "$src" "$dst" 2>/dev/null
}

# Copy a unit file, tracking whether any change was made across this run.
UNITS_CHANGED=0
copy_unit_if_changed() {
    local src="$1" dst_name="$2"
    local dst="$SYSTEMD_DIR/$dst_name"
    if [[ ! -f "$src" ]]; then
        echo "  skip: $dst_name (not present in repo at $src)"
        return
    fi
    if file_needs_update "$src" "$dst"; then
        cp "$src" "$dst"
        chmod 644 "$dst"
        echo "  copied: $dst_name"
        UNITS_CHANGED=1
    else
        echo "  unchanged: $dst_name"
    fi
}

# ----- 1. Pull -------------------------------------------------------------
echo "==> Fetching latest from origin as $SERVICE_USER..."
BEFORE_HEAD=$(run_as_service_user "git rev-parse HEAD")
run_as_service_user "git pull --ff-only"
AFTER_HEAD=$(run_as_service_user "git rev-parse HEAD")

if [[ "$BEFORE_HEAD" == "$AFTER_HEAD" ]]; then
    echo "    already up to date at ${BEFORE_HEAD:0:7}"
else
    echo "    moved ${BEFORE_HEAD:0:7} -> ${AFTER_HEAD:0:7}"
fi

# ----- 2. npm install (only if package files changed) ----------------------
# Look at whether package.json or package-lock.json changed between the two
# heads. If either did, run npm install. This avoids ~5-15s of npm on every
# invocation when nothing's actually changed there.
if [[ "$BEFORE_HEAD" != "$AFTER_HEAD" ]]; then
    if run_as_service_user "git diff --quiet '$BEFORE_HEAD' '$AFTER_HEAD' -- package.json package-lock.json"; then
        echo "==> package.json / package-lock.json unchanged; skipping npm install"
    else
        echo "==> package files changed; running npm install as $SERVICE_USER..."
        run_as_service_user "npm install"
    fi
else
    echo "==> No new commits; skipping npm install"
fi

# ----- 3. Unit files -------------------------------------------------------
echo "==> Reconciling systemd unit files..."
copy_unit_if_changed "$REPO_DIR/docs/systemd/$MAIN_UNIT" "$MAIN_UNIT"
copy_unit_if_changed "$REPO_DIR/docs/systemd/$TIMER_UNIT" "$TIMER_UNIT"
copy_unit_if_changed "$REPO_DIR/docs/systemd/$NOTIFY_UNIT" "$NOTIFY_UNIT"

# ----- 4. daemon-reload if anything changed --------------------------------
if [[ $UNITS_CHANGED -eq 1 ]]; then
    echo "==> Reloading systemd (one or more units changed)..."
    systemctl daemon-reload
else
    echo "==> No unit files changed; skipping daemon-reload"
fi

# ----- 5. Verify units -----------------------------------------------------
echo "==> Verifying unit files (systemd-analyze verify)..."
# systemd-analyze verify exits non-zero on hard errors and prints warnings
# to stderr on soft issues. We want to surface both without failing this
# script on soft warnings.
VERIFY_OUT=$(systemd-analyze verify \
    "$SYSTEMD_DIR/$MAIN_UNIT" \
    "$SYSTEMD_DIR/$TIMER_UNIT" \
    "$SYSTEMD_DIR/$NOTIFY_UNIT" 2>&1) || true
if [[ -n "$VERIFY_OUT" ]]; then
    echo "    verify reported:"
    echo "$VERIFY_OUT" | sed 's/^/      /'
else
    echo "    (clean - no warnings)"
fi

# ----- 6. Ensure the timer is enabled and running --------------------------
# Do NOT restart the main service - it's a oneshot; the timer will fire it
# on its next scheduled tick with the updated unit definition. The timer
# ITSELF should be restarted if its file changed (rare).
if ! systemctl is-enabled --quiet "$TIMER_UNIT"; then
    echo "==> Timer was not enabled; enabling and starting..."
    systemctl enable --now "$TIMER_UNIT"
elif [[ $UNITS_CHANGED -eq 1 ]]; then
    echo "==> Restarting timer to pick up any unit changes..."
    systemctl restart "$TIMER_UNIT"
else
    echo "==> Timer already enabled and running; no restart needed"
fi

# ----- 7. Report -----------------------------------------------------------
echo
echo "==> Done. Next scheduled fire:"
systemctl list-timers --no-pager "$TIMER_UNIT" \
    | awk 'NR==1 || /amateur/' \
    | sed 's/^/    /'
echo
echo "    To watch fires live:"
echo "        journalctl -u 'amateur-callsigns-mirror*' -f"
