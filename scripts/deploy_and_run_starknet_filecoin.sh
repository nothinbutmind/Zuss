#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STARKNET_DIR="${ROOT_DIR}/starknet"
FRONTEND_DIR="${ROOT_DIR}/frontend"
ZUSPROTOCOL_DIR="${ROOT_DIR}/zusprotocol"

DEFAULT_STARKNET_RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_8"
DEFAULT_FILECOIN_RPC_URL="https://rpc.ankr.com/filecoin_testnet"
DEFAULT_USERSLIST_PORT="3000"
DEFAULT_RELAYER_PORT="4000"
DEFAULT_FRONTEND_PORT="5173"
DEFAULT_STARKNET_CHAIN_ID="SN_SEPOLIA"
DEFAULT_NETWORK_NAME="Starknet Sepolia"
DEFAULT_CAMPAIGN_MESSAGE="ZUSMVP01"

if [[ -f "$(brew --prefix asdf 2>/dev/null)/libexec/asdf.sh" ]]; then
  # shellcheck disable=SC1091
  . "$(brew --prefix asdf)/libexec/asdf.sh"
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

need_cmd() {
  local command="$1"
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Missing required command: ${command}" >&2
    exit 1
  fi
}

json_field() {
  local path="$1"
  local selector="$2"
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const selector = process.argv[2];
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    const value = selector.split(".").reduce((current, key) => current?.[key], data);
    if (value === undefined || value === null || value === "") {
      process.exit(1);
    }
    process.stdout.write(String(value));
  ' "${path}" "${selector}"
}

deploy_filecoin_registry() {
  echo ""
  echo "==> Deploying CampaignRegistry to Filecoin"
  local output
  output="$(
    cd "${ZUSPROTOCOL_DIR}"
    forge create src/CampaignRegistry.sol:CampaignRegistry \
      --rpc-url "${FILECOIN_RPC_URL}" \
      --private-key "${FILECOIN_PRIVATE_KEY}" \
      --broadcast 2>&1
  )"
  printf '%s\n' "${output}"

  FILECOIN_REGISTRY_ADDRESS="$(
    printf '%s\n' "${output}" | awk '/Deployed to:/ { print $3 }' | tail -n 1
  )"

  if [[ -z "${FILECOIN_REGISTRY_ADDRESS}" ]]; then
    echo "Could not extract FILECOIN_REGISTRY_ADDRESS from forge output." >&2
    exit 1
  fi
}

install_if_missing() {
  local directory="$1"
  local install_cmd="$2"
  local marker="${directory}/node_modules"
  if [[ -d "${marker}" ]]; then
    return
  fi

  echo ""
  echo "==> Installing dependencies in ${directory}"
  (
    cd "${directory}"
    eval "${install_cmd}"
  )
}

need_cmd node
need_cmd npm
need_cmd pnpm
need_cmd cargo
need_cmd scarb

if [[ -z "${RUSTUP_TOOLCHAIN:-}" ]] && command -v rustup >/dev/null 2>&1; then
  latest_rust_toolchain="$(
    rustup toolchain list | awk '{ print $1 }' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -n 1
  )"
  if [[ -n "${latest_rust_toolchain}" ]]; then
    export RUSTUP_TOOLCHAIN="${latest_rust_toolchain}"
  fi
fi

export STARKNET_RPC_URL="${STARKNET_RPC_URL:-${DEFAULT_STARKNET_RPC_URL}}"
export FILECOIN_RPC_URL="${FILECOIN_RPC_URL:-${DEFAULT_FILECOIN_RPC_URL}}"
export USERSLIST_PORT="${USERSLIST_PORT:-${DEFAULT_USERSLIST_PORT}}"
export RELAYER_PORT="${RELAYER_PORT:-${DEFAULT_RELAYER_PORT}}"
export FRONTEND_PORT="${FRONTEND_PORT:-${DEFAULT_FRONTEND_PORT}}"
export STARKNET_CHAIN_ID="${STARKNET_CHAIN_ID:-${DEFAULT_STARKNET_CHAIN_ID}}"
export VITE_STARKNET_NETWORK_NAME="${VITE_STARKNET_NETWORK_NAME:-${DEFAULT_NETWORK_NAME}}"
export VITE_ZUS_CAMPAIGN_MESSAGE="${VITE_ZUS_CAMPAIGN_MESSAGE:-${DEFAULT_CAMPAIGN_MESSAGE}}"

export FILECOIN_PRIVATE_KEY="${FILECOIN_PRIVATE_KEY:-${PRIVATE_KEY:-}}"

require_env STARKNET_ACCOUNT_ADDRESS
require_env STARKNET_PRIVATE_KEY
require_env FILECOIN_PRIVATE_KEY

if [[ -z "${FILECOIN_REGISTRY_ADDRESS:-}" ]]; then
  need_cmd forge
fi

install_if_missing "${STARKNET_DIR}" "npm install"
install_if_missing "${FRONTEND_DIR}" "pnpm install"

if [[ -z "${FILECOIN_REGISTRY_ADDRESS:-}" ]]; then
  deploy_filecoin_registry
fi

echo ""
echo "==> Deploying Starknet contracts"
(
  cd "${STARKNET_DIR}"
  node --experimental-strip-types scripts/deploy_full.ts
)

STARKNET_PROTOCOL_ADDRESS="$(json_field "${STARKNET_DIR}/deployments.json" "contracts.zusProtocol.address")"
STARKNET_VERIFIER_ADDRESS="$(json_field "${STARKNET_DIR}/deployments.json" "contracts.verifier.address")"
STARKNET_PAYOUT_TOKEN_ADDRESS="$(json_field "${STARKNET_DIR}/deployments.json" "contracts.payoutToken.address")"

export RELAYER_ACCOUNT_ADDRESS="${RELAYER_ACCOUNT_ADDRESS:-${STARKNET_ACCOUNT_ADDRESS}}"
export RELAYER_PRIVATE_KEY="${RELAYER_PRIVATE_KEY:-${STARKNET_PRIVATE_KEY}}"

export PRIVATE_KEY="${FILECOIN_PRIVATE_KEY}"
export ZUS_PROTOCOL_ADDRESS="${STARKNET_PROTOCOL_ADDRESS}"
export VITE_API_BASE_URL="http://127.0.0.1:${USERSLIST_PORT}"
export VITE_ZUS_RELAYER_URL="http://127.0.0.1:${RELAYER_PORT}"
export VITE_STARKNET_RPC_URL="${STARKNET_RPC_URL}"
export VITE_STARKNET_PROTOCOL_ADDRESS="${STARKNET_PROTOCOL_ADDRESS}"
export VITE_STARKNET_VERIFIER_ADDRESS="${STARKNET_VERIFIER_ADDRESS}"
export VITE_STARKNET_PAYOUT_TOKEN_ADDRESS="${STARKNET_PAYOUT_TOKEN_ADDRESS}"
export VITE_STARKNET_CHAIN_ID="${STARKNET_CHAIN_ID}"

echo ""
echo "==> Deployment summary"
echo "Filecoin RPC:            ${FILECOIN_RPC_URL}"
echo "Filecoin registry:       ${FILECOIN_REGISTRY_ADDRESS}"
echo "Starknet RPC:            ${STARKNET_RPC_URL}"
echo "Starknet protocol:       ${STARKNET_PROTOCOL_ADDRESS}"
echo "Starknet verifier:       ${STARKNET_VERIFIER_ADDRESS}"
echo "Starknet payout token:   ${STARKNET_PAYOUT_TOKEN_ADDRESS}"
echo "Userslist API:           http://127.0.0.1:${USERSLIST_PORT}"
echo "Relayer:                 http://127.0.0.1:${RELAYER_PORT}"
echo "Frontend:                http://127.0.0.1:${FRONTEND_PORT}"

echo ""
echo "==> Starting userslist, relayer, and frontend"
(
  cd "${FRONTEND_DIR}"
  pnpm run dev
)
