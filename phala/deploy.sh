#!/usr/bin/env bash
# Deploy the shared enclave to a Phala dstack CVM (real Intel TDX).
#
# Credits burn per hour, so this pairs with teardown.sh: deploy, prove, destroy.
# It refuses to run when a CVM already exists — two running CVMs is the
# expensive mistake, and the whole point of this kit is not making it.
#
#   PHALA_API_KEY=… ENCLAVE_IMAGE=ghcr.io/nickthelegend/dorr-enclave:6 ./deploy.sh
set -euo pipefail

API=https://cloud-api.phala.network/api/v1
: "${PHALA_API_KEY:?set PHALA_API_KEY}"
: "${ENCLAVE_IMAGE:?set ENCLAVE_IMAGE (must be PUBLIC — the CVM pulls it with no creds)}"

export CVM_NAME="${CVM_NAME:-dorr-enclave}"
export TEEPOD_ID="${TEEPOD_ID:-18}"       # 18 = prod9, 26 = prod5 (both US-WEST-1)
export VCPU="${VCPU:-1}" MEM="${MEM:-2048}" DISK="${DISK:-20}"   # ≈ tdx.small, $0.06/hr

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "0 · refuse to double-spend"
n=$(curl -fsS -H "X-API-Key: $PHALA_API_KEY" "$API/cvms" |
    python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')
if [ "$n" != "0" ]; then
  echo "  $n CVM(s) already running and billing. Run ./teardown.sh first."
  exit 1
fi
echo "  none running — safe to create one"

say "1 · load the enclave secrets"
# From a local gitignored file, not Heroku. The dorr-enclave app was deleted once
# the enclave moved to TDX, and this seed is the one thing that could not be
# recreated: every tenant address derives from it and dorr's is registered on
# TEEAttestationVerifier, so a different seed silently stops the chain
# recognising our quotes. It was copied out before that app was removed.
SECRETS="$(dirname "$0")/.enclave-secrets.json"
[ -f "$SECRETS" ] || { echo "missing $SECRETS — cannot deploy without the master seed"; exit 1; }
get() { python3 -c "import json;print(json.load(open('$SECRETS')).get('$1',''))"; }

export TEE_MASTER_SEED; TEE_MASTER_SEED=$(get TEE_MASTER_SEED)
[ -n "$TEE_MASTER_SEED" ] || { echo "TEE_MASTER_SEED missing — refusing to deploy"; exit 1; }
echo "  seed loaded (len ${#TEE_MASTER_SEED}) — tenant addresses will be unchanged"

export TEE_PROJECTS TEE_MEASUREMENT TEE_ENCLAVE_KEY TEE_ID FLARE_RPC_URL
export DORR_VAULT_ADDRESS DORR_SETTLEMENT_ADDRESS DORR_TEE_VERIFIER_ADDRESS
TEE_PROJECTS=$(get TEE_PROJECTS); TEE_MEASUREMENT=$(get TEE_MEASUREMENT)
TEE_ENCLAVE_KEY=$(get TEE_ENCLAVE_KEY); TEE_ID=$(get TEE_ID)
FLARE_RPC_URL=$(get FLARE_RPC_URL)
DORR_VAULT_ADDRESS=$(get DORR_VAULT_ADDRESS)
DORR_SETTLEMENT_ADDRESS=$(get DORR_SETTLEMENT_ADDRESS)
DORR_TEE_VERIFIER_ADDRESS=$(get DORR_TEE_VERIFIER_ADDRESS)
echo "  tenants: $TEE_PROJECTS"

say "2 · render compose"
envsubst < "$(dirname "$0")/docker-compose.yml" > /tmp/dorr-compose.yml
echo "  $(wc -l < /tmp/dorr-compose.yml) lines"

say "3 · resolve a valid dstack image"
# Image names carry a build suffix (dstack-0.5.10-4c9bd024) and rotate, so they
# cannot be hard-coded. A stale name fails the create with a 400 — harmless, but
# it wastes a window you may be paying attention during. Ask the node.
export DSTACK_IMAGE
DSTACK_IMAGE=$(curl -fsS -H "X-API-Key: $PHALA_API_KEY" "$API/teepods/$TEEPOD_ID/images" |
  python3 -c "
import sys, json, re
names = [i['name'] for i in json.load(sys.stdin)]
# newest plain dstack build: no -dev (unstable), no -nvidia (GPU tier, pricier)
ok = [n for n in names if n.startswith('dstack-') and '-dev-' not in n and 'nvidia' not in n]
def key(n):
    m = re.match(r'dstack-(\\d+)\\.(\\d+)\\.(\\d+)', n)
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
print(sorted(ok, key=key)[-1])")
echo "  $DSTACK_IMAGE"

say "4 · create the CVM — billing starts here"
python3 - > /tmp/dorr-payload.json <<'PY'
import json, os
print(json.dumps({
    "name": os.environ["CVM_NAME"],
    "compose_manifest": {
        "name": os.environ["CVM_NAME"],
        "docker_compose_file": open("/tmp/dorr-compose.yml").read(),
        "features": ["kms", "tproxy-net"],
        "public_logs": True,
        "public_sysinfo": True,
    },
    "vcpu": int(os.environ["VCPU"]),
    "memory": int(os.environ["MEM"]),
    "disk_size": int(os.environ["DISK"]),
    "teepod_id": int(os.environ["TEEPOD_ID"]),
    "image": os.environ["DSTACK_IMAGE"],
}))
PY

curl -fsS -X POST "$API/cvms/from_cvm_configuration" \
  -H "X-API-Key: $PHALA_API_KEY" -H "Content-Type: application/json" \
  --data @/tmp/dorr-payload.json | tee /tmp/phala-cvm.json |
  python3 -c 'import sys,json; d=json.load(sys.stdin); print("  app_id:", d.get("app_id") or d.get("hosted",{}).get("app_id")); print("  status:", d.get("status"))'

say "5 · next"
echo "  wait ~2 min, then ./verify.sh   (proves hardware + all three tenants)"
echo "  then                ./teardown.sh (stops the meter)"
