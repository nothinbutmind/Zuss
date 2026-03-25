#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  deploy_zusprotocol.sh --rpc-url <url> --private-key <key>

Options:
  --rpc-url <url>      RPC URL for deployment
  --private-key <key>  Deployer private key
  -h, --help           Show this help
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTOCOL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RPC_URL=""
PRIVATE_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rpc-url)
      RPC_URL="${2:-}"
      shift 2
      ;;
    --private-key)
      PRIVATE_KEY="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${RPC_URL}" || -z "${PRIVATE_KEY}" ]]; then
  echo "--rpc-url and --private-key are required" >&2
  usage >&2
  exit 1
fi

echo "==> Building ZusProtocol"
forge build --root "${PROTOCOL_DIR}" --force

echo "==> Deploying ZusProtocol manager"
DEPLOY_OUTPUT="$(
  forge create \
    --root "${PROTOCOL_DIR}" \
    --broadcast \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}" \
    src/ZusProtocol.sol:ZusProtocol 2>&1
)" || {
  printf '%s\n' "${DEPLOY_OUTPUT}" >&2
  exit 1
}
printf '%s\n' "${DEPLOY_OUTPUT}"

DEPLOYED_ADDRESS="$(
  printf '%s\n' "${DEPLOY_OUTPUT}" | awk -F': ' '/Deployed to:/ { print $2; exit }'
)"
if [[ -z "${DEPLOYED_ADDRESS}" ]]; then
  echo "Could not determine deployed address" >&2
  exit 1
fi

echo
echo "ZusProtocol deployed:"
echo "  address: ${DEPLOYED_ADDRESS}"
echo
echo "Next step:"
echo "  ./scripts/create_campaign.sh --protocol ${DEPLOYED_ADDRESS} --campaign-id <bytes32-or-uuid> --eligible-root <root> --payout-wei <wei> --rpc-url ${RPC_URL} --private-key <key>"
