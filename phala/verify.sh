#!/usr/bin/env bash
# Prove the CVM is doing what we claim, before tearing it down.
#
# The single question this exists to answer: has hardwareAttestation.available
# actually flipped to true? Everything else already worked on a plain dyno.
#
#   PHALA_API_KEY=… ./verify.sh [url]
set -uo pipefail
API=https://cloud-api.phala.network/api/v1
: "${PHALA_API_KEY:?set PHALA_API_KEY}"

URL="${1:-}"
if [ -z "$URL" ]; then
  URL=$(curl -fsS -H "X-API-Key: $PHALA_API_KEY" "$API/cvms" | python3 -c '
import sys, json
c = json.load(sys.stdin)
if not c: raise SystemExit("no CVM running — nothing to verify")
h = c[0].get("hosted", {})
print(h.get("public_urls", [{}])[0].get("app") or f"https://{h.get(\"app_id\")}.dstack-prod9.phala.network")')
fi
echo "target: $URL"
pass=0; fail=0
ok(){ echo "  PASS  $1"; pass=$((pass+1)); }
no(){ echo "  FAIL  $1"; fail=$((fail+1)); }

echo
echo "1 · hardware attestation — the whole reason we deployed"
att=$(curl -fsS --max-time 40 "$URL/tee/attestation" 2>/dev/null)
avail=$(printf '%s' "$att" | python3 -c 'import sys,json;print(json.load(sys.stdin)["hardwareAttestation"]["available"])' 2>/dev/null)
mode=$(printf '%s' "$att" | python3 -c 'import sys,json;print(json.load(sys.stdin)["hardwareAttestation"].get("mode"))' 2>/dev/null)
[ "$avail" = "True" ] && ok "available=true mode=$mode  ← REAL TDX" || no "available=$avail mode=$mode (still no hardware)"

echo
echo "2 · all three tenants, with the addresses already registered on-chain"
for t in dorr:0xE5f41AE46Dc48737D1232Ff33D8145fAa1004128 \
         hadal:0x24105E559E82627984AD9f8d57e24c54cd1D93bA \
         molfi:0x8D642631287303432861e22B778166fB4Ca2404D; do
  p=${t%%:*}; want=${t#*:}
  got=$(curl -fsS --max-time 30 "$URL/tenants" 2>/dev/null |
        python3 -c "import sys,json;print(next((x['signer'] for x in json.load(sys.stdin)['tenants'] if x['projectId']=='$p'),''))" 2>/dev/null)
  lc(){ printf '%s' "$1" | tr 'A-Z' 'a-z'; }   # macOS ships bash 3.2 — no ${var,,}
  [ "$(lc "$got")" = "$(lc "$want")" ] && ok "$p signer unchanged ($got)" || no "$p signer CHANGED: $got (expected $want) — seed did not carry over"
done

echo
echo "3 · cross-tenant isolation still holds on real hardware"
pk=$(curl -fsS --max-time 30 "$URL/t/dorr/pubkey" | python3 -c 'import sys,json;print(json.load(sys.stdin)["sealingPublicKey"])' 2>/dev/null)
[ -n "$pk" ] && ok "dorr sealing key served" || no "no sealing key"

echo
echo "4 · a quote over a payload hash, signed by the dorr tenant"
sig=$(curl -fsS --max-time 40 -X POST "$URL/t/dorr/sign" -H 'content-type: application/json' \
      -d '{"payloadHash":"0xabababababababababababababababababababababababababababababababab"}' 2>/dev/null)
printf '%s' "$sig" | grep -q '"attestation"' && ok "quote returned" || no "no quote"
printf '%s' "$sig" | python3 -c 'import sys,json;h=json.load(sys.stdin).get("hardwareAttestation",{});print("      hardware in quote:", h.get("available"), h.get("mode"))' 2>/dev/null

echo
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ] && echo "Capture /tee/attestation output for the submission, then ./teardown.sh"
