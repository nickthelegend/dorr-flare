#!/usr/bin/env bash
# Destroy every CVM on the account. This is what stops the meter.
#
# Stopping is not enough — a stopped CVM still bills for its disk
# ($0.000139/GB/hr). Small, but the habit that protects a $20 budget is
# "destroy when done", not "stop when done".
#
#   PHALA_API_KEY=… ./teardown.sh
set -euo pipefail
API=https://cloud-api.phala.network/api/v1
: "${PHALA_API_KEY:?set PHALA_API_KEY}"

cvms=$(curl -fsS -H "X-API-Key: $PHALA_API_KEY" "$API/cvms")
ids=$(printf '%s' "$cvms" | python3 -c '
import sys, json
for c in json.load(sys.stdin):
    h = c.get("hosted", {})
    print(h.get("app_id") or c.get("app_id") or c.get("id"))')

if [ -z "$ids" ]; then
  echo "no CVMs — nothing billing. Nothing to do."
  exit 0
fi

for id in $ids; do
  echo "destroying $id…"
  curl -fsS -X POST "$API/cvms/app_$id/destroy" -H "X-API-Key: $PHALA_API_KEY" >/dev/null \
    || curl -fsS -X DELETE "$API/cvms/app_$id" -H "X-API-Key: $PHALA_API_KEY" >/dev/null
done

echo
echo "confirming the account is empty…"
left=$(curl -fsS -H "X-API-Key: $PHALA_API_KEY" "$API/cvms" |
       python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
[ "$left" = "0" ] && echo "  0 CVMs — meter stopped." || echo "  WARNING: $left still present, check the dashboard."
