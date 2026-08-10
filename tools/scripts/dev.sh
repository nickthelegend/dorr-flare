#!/usr/bin/env bash
# dorr dev harness — everything runs locally except Cardano preprod.
#   ./tools/scripts/dev.sh <up|down|fund-midnight|operator|web|status|e2e|preprod>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
set -a; [ -f .env ] && . ./.env; set +a
OP="http://localhost:${OPERATOR_PORT:-8790}"

midnet() { echo "$ROOT/vendor/midnight-local-network"; }

case "${1:-}" in
  up)
    echo "▸ starting dorr Midnight localnet (proof :6301, indexer :8088, node :9945)…"
    docker compose -p dorr-midnight -f "$(midnet)/compose.dorr.yml" up -d
    echo "▸ waiting for indexer health…"
    until curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8088/api/v3/graphql \
      -H 'content-type: application/json' -d '{"query":"{ __typename }"}' | grep -q 200; do sleep 2; done
    echo "✓ localnet healthy. Next: ./tools/scripts/dev.sh fund-midnight (once), then operator."
    ;;
  down)
    docker compose -p dorr-midnight -f "$(midnet)/compose.dorr.yml" down
    ;;
  fund-midnight)
    echo "▸ funding operator Midnight wallet from local genesis (once per fresh localnet)…"
    cd vendor/zkperps
    BIP39_MNEMONIC="$MIDNIGHT_MNEMONIC" npx tsx midnight-local-cli/src/fund-local-undeployed.ts
    ;;
  operator)
    echo "▸ operator on $OP (Ctrl-C to stop)"
    exec bun run --cwd services/operator start
    ;;
  web)
    echo "▸ web on http://localhost:3000"
    exec bun run --cwd apps/web dev
    ;;
  preprod)
    echo "▸ bootstrapping Cardano preprod (needs a funded deployer)…"
    exec bun run --cwd services/operator src/scripts/deploy-preprod.ts
    ;;
  status)
    echo "docker:"; docker ps --format '  {{.Names}} {{.Status}}' | grep dorr || echo "  (localnet down)"
    echo -n "operator: "; curl -s "$OP/health" || echo "(down)"; echo
    echo -n "deployer funded: "; curl -s "$OP/ops/balances" 2>/dev/null || echo "(cardano not ready / unfunded)"; echo
    ;;
  e2e)
    exec bash "$ROOT/tools/scripts/e2e-local.sh"
    ;;
  *)
    echo "usage: dev.sh <up|down|fund-midnight|operator|web|status|e2e|preprod>"; exit 1;;
esac
