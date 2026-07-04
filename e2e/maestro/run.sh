#!/usr/bin/env bash
# Run the Maestro iOS UI regression flows against the booted simulator.
# Usage: ./e2e/maestro/run.sh [flow.yaml ...]   (default: all flows in flows/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"
export PATH="$PATH:$HOME/.maestro/bin"

command -v maestro >/dev/null 2>&1 || {
  echo "maestro not found. Install: curl -Ls https://get.maestro.mobile.dev | bash" >&2
  exit 1
}

# Booted iOS simulator UDID (Maestro needs --device when >1 device is attached).
DEVICE="$(xcrun simctl list devices booted 2>/dev/null | grep -Eo '[0-9A-F]{8}-[0-9A-F-]{27}' | head -1)"
[ -n "$DEVICE" ] || { echo "No booted iOS simulator found." >&2; exit 1; }
echo "Using simulator: $DEVICE"

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  # Run each flow sequentially — a folder target makes Maestro run flows
  # concurrently, and they fight over the single app instance.
  TARGETS=("$HERE"/flows/*.yaml)
fi

status=0
for t in "${TARGETS[@]}"; do
  # allow paths relative to this dir
  [ -e "$t" ] || t="$HERE/$t"
  echo "== maestro test $t =="
  maestro --device "$DEVICE" test "$t" || status=1
done
exit "$status"
