#!/usr/bin/env bash
# Full local E2E: commit → (real ZK) → execute → (real ZK match) → close → (real ZK settle).
# Cardano anchor is expected to fail until the deployer is funded — reported, not fatal.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
OP="http://localhost:${OPERATOR_PORT:-8790}"
ADDR="addr_test1e2e"

j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
wait_job() { until curl -s "$OP/jobs/$1" | grep -qE '"status": ?"(complete|error)"'; do sleep 3; done; }

echo "▸ health"; curl -s "$OP/health" | j "['service']" || { echo "operator down"; exit 1; }

echo "▸ seeding off-chain balance for $ADDR (bypasses on-chain deposit for the local test)"
python3 - "$ROOT/services/operator/data/state.json" "$ADDR" <<'PY'
import json,sys
p,addr=sys.argv[1],sys.argv[2]
try: s=json.load(open(p))
except FileNotFoundError: s={"accounts":{},"orders":[],"positions":[],"jobs":[],"feed":[],"anchors":[],"insuranceFundUsd":0,"fundingHistory":[]}
s.setdefault("accounts",{})[addr]={"address":addr,"balance":50000,"locked":0,"creditedUtxos":["e2e#0"]}
json.dump(s,open(p,"w"),indent=2)
print("  seeded 50000 dUSD (restart operator to load, or this test assumes fresh boot)")
PY
echo "  NOTE: restart the operator after seeding so it reloads state, then re-run e2e."

echo "▸ commit private order (ADA 5x LONG, 1000 dUSD)"
COMMIT=$(curl -s -X POST "$OP/orders/commit" -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"marketId\":\"ADA-dUSD\",\"side\":\"LONG\",\"marginUsd\":1000,\"leverage\":5,\"privacyMode\":\"private\"}")
echo "$COMMIT" | j ""
OID=$(echo "$COMMIT" | j "['orderId']"); JOB=$(echo "$COMMIT" | j "['jobId']")
HASH=$(echo "$COMMIT" | j "['commitmentHash']")
echo "  commitment (all the public sees): $HASH"
echo "▸ public feed:"; curl -s "$OP/feed" | j "['feed'][0]"

echo "▸ waiting for Midnight commit proof…"; wait_job "$JOB"
curl -s "$OP/jobs/$JOB" | j "['steps'][0]['label']"; curl -s "$OP/jobs/$JOB" | j "['status']"

echo "▸ execute (vAMM fill)"; EXE=$(curl -s -X POST "$OP/orders/$OID/execute"); PID=$(echo "$EXE" | j "['position']['id']"); MJOB=$(echo "$EXE" | j "['jobId']")
echo "  position $PID entry=$(echo "$EXE" | j "['position']['entryPrice']")"
echo "▸ waiting for Midnight match proof…"; wait_job "$MJOB"; curl -s "$OP/jobs/$MJOB" | j "['status']"

echo "▸ close position"; CL=$(curl -s -X POST "$OP/positions/$PID/close"); CJOB=$(echo "$CL" | j "['jobId']")
echo "  realizedPnl=$(echo "$CL" | j "['position']['realizedPnl']")"
echo "▸ waiting for settle proof + cardano anchor…"; wait_job "$CJOB"
echo "▸ close job steps:"; curl -s "$OP/jobs/$CJOB" | python3 -c "import sys,json;[print('  -',s['label'],'→',s['status']) for s in json.load(sys.stdin)['steps']]"

echo "▸ A/B sandwich demo (deterministic):"
curl -s -X POST "$OP/demo/ab" -H 'content-type: application/json' \
  -d '{"marketId":"ADA-dUSD","side":"LONG","marginUsd":1000,"leverage":10}' | j "['headline']"
echo "✓ local E2E done (anchor step needs a funded deployer)."
