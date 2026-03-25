#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  create_three_reward_campaigns.sh --protocol <address> --rpc-url <url> --private-key <key> [options]

Options:
  --protocol <address>          Deployed ZusProtocol address
  --rpc-url <url>               RPC URL
  --private-key <key>           Signer private key for onchain txs
  --api-base-url <url>          Rust API base URL (default: http://127.0.0.1:3000)
  --campaign-creator <address>  Creator address stored in the Rust API and included in the tree
  --verifier <address>          Shared verifier address
  --message <ascii>             Exactly 8 ASCII bytes (default: ZUSMVP01)
  --payout-flow <amount>        Human-readable payout amount, for example 0.0001
  --funding-flow <amount>       Human-readable funding amount, for example 0.0011
  --payout-avax <amount>        Legacy alias for --payout-flow
  --funding-avax <amount>       Legacy alias for --funding-flow
  --payout-wei <wei>            Override payout in wei
  --funding-wei <wei>           Override funding in wei
  -h, --help                    Show this help

Notes:
  - This script creates exactly three campaigns:
      crecimiento_rewards
      avalance_rewards
      latam_rewards
  - Each campaign includes the campaign creator address plus 10 mock addresses in the Rust API tree.
  - The script writes to the Rust API first, then creates the matching onchain campaign.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_API_BASE_URL="http://127.0.0.1:3000"
DEFAULT_CAMPAIGN_CREATOR="0x308056ef9E0e21CD3e15414F59a17e9d4C510638"
DEFAULT_VERIFIER="${ZUS_VERIFIER_ADDRESS:-}"
DEFAULT_MESSAGE="ZUSMVP01"
DEFAULT_PAYOUT_FLOW="0.0001"
DEFAULT_FUNDING_FLOW="0.0011"

PROTOCOL_ADDRESS=""
RPC_URL=""
PRIVATE_KEY=""
API_BASE_URL="${DEFAULT_API_BASE_URL}"
CAMPAIGN_CREATOR="${DEFAULT_CAMPAIGN_CREATOR}"
VERIFIER_ADDRESS="${DEFAULT_VERIFIER}"
MESSAGE="${DEFAULT_MESSAGE}"
PAYOUT_FLOW="${DEFAULT_PAYOUT_FLOW}"
FUNDING_FLOW="${DEFAULT_FUNDING_FLOW}"
PAYOUT_WEI=""
FUNDING_WEI=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --protocol)
      PROTOCOL_ADDRESS="${2:-}"
      shift 2
      ;;
    --rpc-url)
      RPC_URL="${2:-}"
      shift 2
      ;;
    --private-key)
      PRIVATE_KEY="${2:-}"
      shift 2
      ;;
    --api-base-url)
      API_BASE_URL="${2:-}"
      shift 2
      ;;
    --campaign-creator)
      CAMPAIGN_CREATOR="${2:-}"
      shift 2
      ;;
    --verifier)
      VERIFIER_ADDRESS="${2:-}"
      shift 2
      ;;
    --message)
      MESSAGE="${2:-}"
      shift 2
      ;;
    --payout-flow)
      PAYOUT_FLOW="${2:-}"
      shift 2
      ;;
    --funding-flow)
      FUNDING_FLOW="${2:-}"
      shift 2
      ;;
    --payout-avax)
      PAYOUT_FLOW="${2:-}"
      shift 2
      ;;
    --funding-avax)
      FUNDING_FLOW="${2:-}"
      shift 2
      ;;
    --payout-wei)
      PAYOUT_WEI="${2:-}"
      shift 2
      ;;
    --funding-wei)
      FUNDING_WEI="${2:-}"
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

if [[ -z "${PROTOCOL_ADDRESS}" || -z "${RPC_URL}" || -z "${PRIVATE_KEY}" ]]; then
  echo "--protocol, --rpc-url, and --private-key are required" >&2
  usage >&2
  exit 1
fi

if [[ ! "${PROTOCOL_ADDRESS}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid protocol address: ${PROTOCOL_ADDRESS}" >&2
  exit 1
fi

if [[ ! "${CAMPAIGN_CREATOR}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid campaign creator address: ${CAMPAIGN_CREATOR}" >&2
  exit 1
fi

if [[ ! "${VERIFIER_ADDRESS}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid verifier address: ${VERIFIER_ADDRESS}. Pass --verifier or set ZUS_VERIFIER_ADDRESS." >&2
  exit 1
fi

if [[ "${#MESSAGE}" -ne 8 ]]; then
  echo "--message must be exactly 8 ASCII bytes for the current circuit" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

if [[ -n "${PAYOUT_WEI}" && ! "${PAYOUT_WEI}" =~ ^[0-9]+$ ]]; then
  echo "--payout-wei must be a base-10 integer" >&2
  exit 1
fi

if [[ -n "${FUNDING_WEI}" && ! "${FUNDING_WEI}" =~ ^[0-9]+$ ]]; then
  echo "--funding-wei must be a base-10 integer" >&2
  exit 1
fi

to_wei() {
  local amount="$1"
  python3 - "$amount" <<'PY'
from decimal import Decimal, InvalidOperation, ROUND_DOWN
import sys

raw = sys.argv[1].strip()
try:
    value = Decimal(raw)
except InvalidOperation as exc:
    raise SystemExit(f"invalid FLOW amount: {raw}") from exc

if value < 0:
    raise SystemExit(f"FLOW amount must be non-negative: {raw}")

scale = Decimal(10) ** 18
wei = (value * scale).quantize(Decimal("1"), rounding=ROUND_DOWN)
if wei != value * scale:
    raise SystemExit(f"FLOW amount has more than 18 decimals: {raw}")

print(int(wei))
PY
}

if [[ -z "${PAYOUT_WEI}" ]]; then
  PAYOUT_WEI="$(to_wei "${PAYOUT_FLOW}")"
fi

if [[ -z "${FUNDING_WEI}" ]]; then
  FUNDING_WEI="$(to_wei "${FUNDING_FLOW}")"
fi

python3 - "${PAYOUT_WEI}" "${FUNDING_WEI}" <<'PY'
import sys

payout = int(sys.argv[1])
funding = int(sys.argv[2])
recipient_count = 11
required = payout * recipient_count

if payout <= 0:
    raise SystemExit("payout must be greater than zero")
if funding < required:
    raise SystemExit(
        f"funding is too small for {recipient_count} recipients: need at least {required} wei"
    )
PY

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

for CAMPAIGN_NAME in crecimiento_rewards avalance_rewards latam_rewards; do
  CREATE_JSON="${TMP_DIR}/${CAMPAIGN_NAME}.json"
  RESPONSE_JSON="${TMP_DIR}/${CAMPAIGN_NAME}.response.json"

  jq -n \
    --arg name "${CAMPAIGN_NAME}" \
    --arg campaign_creator_address "${CAMPAIGN_CREATOR}" \
    '{
      name: $name,
      campaign_creator_address: $campaign_creator_address,
      recipients: [
        { leaf_address: $campaign_creator_address, amount: "100" },
        { leaf_address: "0x0000000000000000000000000000000000000001", amount: "200" },
        { leaf_address: "0x0000000000000000000000000000000000000002", amount: "300" },
        { leaf_address: "0x0000000000000000000000000000000000000003", amount: "400" },
        { leaf_address: "0x0000000000000000000000000000000000000004", amount: "500" },
        { leaf_address: "0x0000000000000000000000000000000000000005", amount: "600" },
        { leaf_address: "0x0000000000000000000000000000000000000006", amount: "700" },
        { leaf_address: "0x0000000000000000000000000000000000000007", amount: "800" },
        { leaf_address: "0x0000000000000000000000000000000000000008", amount: "900" },
        { leaf_address: "0x0000000000000000000000000000000000000009", amount: "1000" },
        { leaf_address: "0x000000000000000000000000000000000000000a", amount: "1100" }
      ]
    }' > "${CREATE_JSON}"

  echo "==> Creating API campaign: ${CAMPAIGN_NAME}"
  curl -fsS \
    -X POST \
    -H 'content-type: application/json' \
    --data @"${CREATE_JSON}" \
    "${API_BASE_URL}/campaigns" > "${RESPONSE_JSON}"

  CAMPAIGN_ID="$(jq -r '.campaign_id' "${RESPONSE_JSON}")"
  ONCHAIN_CAMPAIGN_ID="$(jq -r '.onchain_campaign_id' "${RESPONSE_JSON}")"
  ELIGIBLE_ROOT="$(jq -r '.merkle_root' "${RESPONSE_JSON}")"

  if [[ -z "${CAMPAIGN_ID}" || "${CAMPAIGN_ID}" == "null" ]]; then
    echo "API did not return campaign_id for ${CAMPAIGN_NAME}" >&2
    cat "${RESPONSE_JSON}" >&2
    exit 1
  fi

  if [[ -z "${ONCHAIN_CAMPAIGN_ID}" || "${ONCHAIN_CAMPAIGN_ID}" == "null" ]]; then
    echo "API did not return onchain_campaign_id for ${CAMPAIGN_NAME}" >&2
    cat "${RESPONSE_JSON}" >&2
    exit 1
  fi

  if [[ -z "${ELIGIBLE_ROOT}" || "${ELIGIBLE_ROOT}" == "null" ]]; then
    echo "API did not return merkle_root for ${CAMPAIGN_NAME}" >&2
    cat "${RESPONSE_JSON}" >&2
    exit 1
  fi

  echo "    api_campaign_id:      ${CAMPAIGN_ID}"
  echo "    onchain_campaign_id:  ${ONCHAIN_CAMPAIGN_ID}"
  echo "    eligible_root:        ${ELIGIBLE_ROOT}"
  echo "    payout_wei:           ${PAYOUT_WEI}"
  echo "    funding_wei:          ${FUNDING_WEI}"

  "${SCRIPT_DIR}/create_campaign.sh" \
    --protocol "${PROTOCOL_ADDRESS}" \
    --campaign-id "${ONCHAIN_CAMPAIGN_ID}" \
    --eligible-root "${ELIGIBLE_ROOT}" \
    --verifier "${VERIFIER_ADDRESS}" \
    --message "${MESSAGE}" \
    --payout-wei "${PAYOUT_WEI}" \
    --funding-wei "${FUNDING_WEI}" \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}"

  echo
done

echo "Created all three reward campaigns successfully."
