#!/usr/bin/env bash
set -euo pipefail

# ZUS Starknet deploy helper using Starknet Foundry (sncast).
#
# How to run:
# 1. Make sure Starknet Foundry and Scarb are installed.
# 2. Make sure your sncast account is already imported and usable.
# 3. Export the required variables:
#    export SNCAST_ACCOUNT="my-account"
#    export STARKNET_RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_8"
# 4. Optional:
#    export SNCAST_ACCOUNTS_FILE="$HOME/.starknet_accounts/starknet_open_zeppelin_accounts.json"
#    export SNCAST_KEYSTORE="/path/to/keystore.json"
#    export SNCAST_ACCOUNT_FILE="/path/to/account.json"
# 5. Run:
#    ./scripts/deploy_foundry.sh
#
# What it does:
# - runs scarb build
# - declares ClaimVerifier and ZusProtocol with sncast
# - deploys both contracts
# - writes starknet/deployments.json
# - prints the relayer env vars you will need next

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARKNET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOYMENTS_PATH="${STARKNET_DIR}/deployments.json"
DEFAULT_RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_8"

if [[ -f "$(brew --prefix asdf)/libexec/asdf.sh" ]]; then
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

json_field() {
  local json_input="$1"
  local field="$2"
  JSON_INPUT="${json_input}" JSON_FIELD="${field}" node -e '
    const input = process.env.JSON_INPUT || "";
    const field = process.env.JSON_FIELD || "";
    const data = JSON.parse(input);
    const pick = (obj, keys) => {
      for (const key of keys) {
        if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
          return obj[key];
        }
      }
      return "";
    };
    const value = pick(data, [field]) ||
      (data.declare ? pick(data.declare, [field]) : "") ||
      (data.deploy ? pick(data.deploy, [field]) : "");
    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
    } else {
      process.stdout.write(String(value));
    }
  '
}

run_sncast() {
  local output
  output="$(sncast "${SNCAST_ARGS[@]}" -j "$@")"
  echo "${output}"
}

require_env "SNCAST_ACCOUNT"

STARKNET_RPC_URL="${STARKNET_RPC_URL:-$DEFAULT_RPC_URL}"
NETWORK_NAME="${STARKNET_NETWORK_NAME:-starknet-sepolia}"

SNCAST_ARGS=(--account "${SNCAST_ACCOUNT}" --url "${STARKNET_RPC_URL}" --wait)

if [[ -n "${SNCAST_ACCOUNTS_FILE:-}" ]]; then
  SNCAST_ARGS+=(--accounts-file "${SNCAST_ACCOUNTS_FILE}")
fi

if [[ -n "${SNCAST_KEYSTORE:-}" ]]; then
  SNCAST_ARGS+=(--keystore "${SNCAST_KEYSTORE}")
fi

if [[ -n "${SNCAST_PROFILE:-}" ]]; then
  SNCAST_ARGS+=(--profile "${SNCAST_PROFILE}")
fi

cd "${STARKNET_DIR}"

echo ""
echo "==> Building Cairo contracts with scarb"
scarb build

echo ""
echo "==> Declaring ClaimVerifier"
CLAIM_VERIFIER_DECLARE="$(run_sncast declare --contract-name ClaimVerifier)"
CLAIM_VERIFIER_CLASS_HASH="$(json_field "${CLAIM_VERIFIER_DECLARE}" "class_hash")"
CLAIM_VERIFIER_DECLARE_TX="$(json_field "${CLAIM_VERIFIER_DECLARE}" "transaction_hash")"

if [[ -z "${CLAIM_VERIFIER_CLASS_HASH}" ]]; then
  echo "Could not extract ClaimVerifier class hash from sncast output." >&2
  echo "${CLAIM_VERIFIER_DECLARE}" >&2
  exit 1
fi

echo ""
echo "==> Deploying ClaimVerifier"
CLAIM_VERIFIER_DEPLOY="$(run_sncast deploy --class-hash "${CLAIM_VERIFIER_CLASS_HASH}")"
CLAIM_VERIFIER_ADDRESS="$(json_field "${CLAIM_VERIFIER_DEPLOY}" "contract_address")"
CLAIM_VERIFIER_DEPLOY_TX="$(json_field "${CLAIM_VERIFIER_DEPLOY}" "transaction_hash")"

if [[ -z "${CLAIM_VERIFIER_ADDRESS}" ]]; then
  echo "Could not extract ClaimVerifier deployed address from sncast output." >&2
  echo "${CLAIM_VERIFIER_DEPLOY}" >&2
  exit 1
fi

echo ""
echo "==> Declaring ZusProtocol"
ZUS_PROTOCOL_DECLARE="$(run_sncast declare --contract-name ZusProtocol)"
ZUS_PROTOCOL_CLASS_HASH="$(json_field "${ZUS_PROTOCOL_DECLARE}" "class_hash")"
ZUS_PROTOCOL_DECLARE_TX="$(json_field "${ZUS_PROTOCOL_DECLARE}" "transaction_hash")"

if [[ -z "${ZUS_PROTOCOL_CLASS_HASH}" ]]; then
  echo "Could not extract ZusProtocol class hash from sncast output." >&2
  echo "${ZUS_PROTOCOL_DECLARE}" >&2
  exit 1
fi

echo ""
echo "==> Deploying ZusProtocol"
ZUS_PROTOCOL_DEPLOY="$(run_sncast deploy --class-hash "${ZUS_PROTOCOL_CLASS_HASH}")"
ZUS_PROTOCOL_ADDRESS="$(json_field "${ZUS_PROTOCOL_DEPLOY}" "contract_address")"
ZUS_PROTOCOL_DEPLOY_TX="$(json_field "${ZUS_PROTOCOL_DEPLOY}" "transaction_hash")"

if [[ -z "${ZUS_PROTOCOL_ADDRESS}" ]]; then
  echo "Could not extract ZusProtocol deployed address from sncast output." >&2
  echo "${ZUS_PROTOCOL_DEPLOY}" >&2
  exit 1
fi

DEPLOYER_ACCOUNT="${SNCAST_ACCOUNT}"

DEPLOYMENTS_PATH="${DEPLOYMENTS_PATH}" \
NETWORK_NAME="${NETWORK_NAME}" \
STARKNET_RPC_URL="${STARKNET_RPC_URL}" \
DEPLOYER_ACCOUNT="${DEPLOYER_ACCOUNT}" \
CLAIM_VERIFIER_CLASS_HASH="${CLAIM_VERIFIER_CLASS_HASH}" \
CLAIM_VERIFIER_DECLARE_TX="${CLAIM_VERIFIER_DECLARE_TX}" \
CLAIM_VERIFIER_ADDRESS="${CLAIM_VERIFIER_ADDRESS}" \
CLAIM_VERIFIER_DEPLOY_TX="${CLAIM_VERIFIER_DEPLOY_TX}" \
ZUS_PROTOCOL_CLASS_HASH="${ZUS_PROTOCOL_CLASS_HASH}" \
ZUS_PROTOCOL_DECLARE_TX="${ZUS_PROTOCOL_DECLARE_TX}" \
ZUS_PROTOCOL_ADDRESS="${ZUS_PROTOCOL_ADDRESS}" \
ZUS_PROTOCOL_DEPLOY_TX="${ZUS_PROTOCOL_DEPLOY_TX}" \
node -e '
  const fs = require("node:fs");
  const payload = {
    network: process.env.NETWORK_NAME,
    rpcUrl: process.env.STARKNET_RPC_URL,
    deployer: process.env.DEPLOYER_ACCOUNT,
    deployedAt: new Date().toISOString(),
    contracts: {
      zusProtocol: {
        address: process.env.ZUS_PROTOCOL_ADDRESS,
        classHash: process.env.ZUS_PROTOCOL_CLASS_HASH,
        declareTransactionHash: process.env.ZUS_PROTOCOL_DECLARE_TX,
        transactionHash: process.env.ZUS_PROTOCOL_DEPLOY_TX,
      },
      verifier: {
        address: process.env.CLAIM_VERIFIER_ADDRESS,
        classHash: process.env.CLAIM_VERIFIER_CLASS_HASH,
        declareTransactionHash: process.env.CLAIM_VERIFIER_DECLARE_TX,
        transactionHash: process.env.CLAIM_VERIFIER_DEPLOY_TX,
      },
    },
  };
  fs.writeFileSync(process.env.DEPLOYMENTS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
'

echo ""
echo "Deployment successful."
echo "ClaimVerifier: ${CLAIM_VERIFIER_ADDRESS}"
echo "ZusProtocol:   ${ZUS_PROTOCOL_ADDRESS}"
echo "deployments:   ${DEPLOYMENTS_PATH}"
echo ""
echo "Relayer env:"
echo "export ZUS_PROTOCOL_ADDRESS=${ZUS_PROTOCOL_ADDRESS}"
echo "export RELAYER_ACCOUNT_ADDRESS=<your_starknet_account_address>"
echo "export RELAYER_PRIVATE_KEY=<your_starknet_private_key>"
echo "export STARKNET_RPC_URL=${STARKNET_RPC_URL}"
