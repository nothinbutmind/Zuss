#!/usr/bin/env bash
set -euo pipefail

# Plain Starknet Sepolia deploy runner for ZUS.
#
# This does NOT use Starknet Foundry.
# It runs the existing starknet.js deployment script in scripts/deploy.ts.
#
# Required env:
#   STARKNET_ACCOUNT_ADDRESS=0x...
#   STARKNET_PRIVATE_KEY=0x...
#
# Optional env:
#   STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io/rpc/v0_8
#
# Usage:
#   cd starknet
#   export STARKNET_ACCOUNT_ADDRESS=0x...
#   export STARKNET_PRIVATE_KEY=0x...
#   ./scripts/deploy_testnet.sh
#
# What it does:
# - installs Node deps if needed
# - runs scarb build
# - declares and deploys ClaimVerifier + ZusProtocol to Starknet Sepolia
# - writes deployments.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARKNET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_8"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

if [[ -f "$(brew --prefix asdf)/libexec/asdf.sh" ]]; then
  # shellcheck disable=SC1091
  . "$(brew --prefix asdf)/libexec/asdf.sh"
fi

require_env "STARKNET_ACCOUNT_ADDRESS"
require_env "STARKNET_PRIVATE_KEY"

export STARKNET_RPC_URL="${STARKNET_RPC_URL:-$DEFAULT_RPC_URL}"

cd "${STARKNET_DIR}"

if [[ ! -d node_modules ]]; then
  echo "==> Installing starknet/ Node dependencies"
  npm install
fi

echo ""
echo "==> Deploying to Starknet Sepolia"
echo "RPC: ${STARKNET_RPC_URL}"
echo "Account: ${STARKNET_ACCOUNT_ADDRESS}"
echo ""

node --experimental-strip-types scripts/deploy.ts

echo ""
echo "Done."
echo "Deployment record written to: ${STARKNET_DIR}/deployments.json"
