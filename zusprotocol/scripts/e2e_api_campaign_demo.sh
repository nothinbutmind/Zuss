#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  e2e_api_campaign_demo.sh --protocol <address> --rpc-url <url> --private-key <key> [options]

Options:
  --protocol <address>          Deployed ZusProtocol address
  --rpc-url <url>               RPC URL
  --private-key <key>           Signer private key for onchain txs
  --api-base-url <url>          Rust API base URL (default: http://127.0.0.1:3000)
  --test-name <name>            Human-readable API campaign name
  --campaign-creator <address>  Campaign creator address stored in the API
  --recipient-address <address> Allowlisted address for the demo proof
  --verifier <address>          Shared verifier address
  --message <ascii>             Exactly 8 ASCII bytes (default: ZUSMVP01)
  --payout-wei <wei>            Fixed onchain payout per successful claim
  --funding-wei <wei>           Initial funding for createCampaign
  --circuit-dir <path>          Noir circuit directory (default: ../zus_addy)
  --witness-name <name>         Noir witness name (default: claim_witness)
  --proof-dir <path>            Output dir for generated proof files
  --bb-crs-path <path>          CRS directory for bb (default: ~/.bb-crs)
  -h, --help                    Show this help

Notes:
  - This script creates the campaign through the Rust API first, so the API owns the Merkle tree.
  - It then creates the matching onchain campaign, generates the Noir proof, and sends claim(...).
  - The demo recipient defaults to the public Anvil test key already used in this repo.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTOCOL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${PROTOCOL_DIR}/.." && pwd)"

DEFAULT_API_BASE_URL="http://127.0.0.1:3000"
DEFAULT_VERIFIER="${ZUS_VERIFIER_ADDRESS:-}"
DEFAULT_MESSAGE="ZUSMVP01"
DEFAULT_CAMPAIGN_CREATOR="0x308056ef9E0e21CD3e15414F59a17e9d4C510638"
DEFAULT_RECIPIENT="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
DEFAULT_WITNESS_NAME="claim_witness"
DEFAULT_DEMO_PRIVATE_KEY="ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEFAULT_STEALTH_TWEAK_HEX="0000000000000000000000000000000000000000000000000000000000000007"

PROTOCOL_ADDRESS=""
RPC_URL=""
PRIVATE_KEY=""
API_BASE_URL="${DEFAULT_API_BASE_URL}"
TEST_NAME="ZUS API E2E $(date -u +%Y-%m-%dT%H:%M:%SZ)"
CAMPAIGN_CREATOR="${DEFAULT_CAMPAIGN_CREATOR}"
RECIPIENT_ADDRESS="${DEFAULT_RECIPIENT}"
VERIFIER_ADDRESS="${DEFAULT_VERIFIER}"
MESSAGE="${DEFAULT_MESSAGE}"
PAYOUT_WEI="100000000000000"
FUNDING_WEI="100000000000000"
CIRCUIT_DIR="${ROOT_DIR}/zus_addy"
WITNESS_NAME="${DEFAULT_WITNESS_NAME}"
PROOF_DIR="${ROOT_DIR}/verifier/generated/stealthdrop/proof_test_api"
BB_CRS_PATH="${HOME}/.bb-crs"

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
    --test-name)
      TEST_NAME="${2:-}"
      shift 2
      ;;
    --campaign-creator)
      CAMPAIGN_CREATOR="${2:-}"
      shift 2
      ;;
    --recipient-address)
      RECIPIENT_ADDRESS="${2:-}"
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
    --payout-wei)
      PAYOUT_WEI="${2:-}"
      shift 2
      ;;
    --funding-wei)
      FUNDING_WEI="${2:-}"
      shift 2
      ;;
    --circuit-dir)
      CIRCUIT_DIR="${2:-}"
      shift 2
      ;;
    --witness-name)
      WITNESS_NAME="${2:-}"
      shift 2
      ;;
    --proof-dir)
      PROOF_DIR="${2:-}"
      shift 2
      ;;
    --bb-crs-path)
      BB_CRS_PATH="${2:-}"
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

if ! command -v nargo >/dev/null 2>&1; then
  echo "nargo is required" >&2
  exit 1
fi

if ! command -v bb >/dev/null 2>&1; then
  echo "bb is required" >&2
  exit 1
fi

if [[ ! -d "${CIRCUIT_DIR}" ]]; then
  echo "Circuit directory not found: ${CIRCUIT_DIR}" >&2
  exit 1
fi

if [[ ! -d "${BB_CRS_PATH}" ]]; then
  echo "CRS path not found: ${BB_CRS_PATH}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

CAMPAIGN_CREATE_JSON="${TMP_DIR}/campaign_create.json"
CAMPAIGN_RESPONSE_JSON="${TMP_DIR}/campaign_response.json"
CLAIM_RESPONSE_JSON="${TMP_DIR}/claim_response.json"
PROVER_PATH="${CIRCUIT_DIR}/Prover.toml"
BYTECODE_PATH="${CIRCUIT_DIR}/target/stealthdrop.json"
WITNESS_PATH="${CIRCUIT_DIR}/target/${WITNESS_NAME}.gz"
VK_PATH="${ROOT_DIR}/verifier/generated/stealthdrop/vk/vk"

jq -n \
  --arg name "${TEST_NAME}" \
  --arg campaign_creator_address "${CAMPAIGN_CREATOR}" \
  --arg leaf_address "${RECIPIENT_ADDRESS}" \
  '{
    name: $name,
    campaign_creator_address: $campaign_creator_address,
    recipients: [
      {
        leaf_address: $leaf_address,
        amount: "1"
      }
    ]
  }' > "${CAMPAIGN_CREATE_JSON}"

echo "==> Creating named API campaign: ${TEST_NAME}"
curl -fsS \
  -X POST \
  -H 'content-type: application/json' \
  --data @"${CAMPAIGN_CREATE_JSON}" \
  "${API_BASE_URL}/campaigns" > "${CAMPAIGN_RESPONSE_JSON}"

CAMPAIGN_ID="$(jq -r '.campaign_id' "${CAMPAIGN_RESPONSE_JSON}")"
ONCHAIN_CAMPAIGN_ID="$(jq -r '.onchain_campaign_id' "${CAMPAIGN_RESPONSE_JSON}")"
ELIGIBLE_ROOT="$(jq -r '.merkle_root' "${CAMPAIGN_RESPONSE_JSON}")"

if [[ -z "${CAMPAIGN_ID}" || "${CAMPAIGN_ID}" == "null" ]]; then
  echo "API did not return campaign_id" >&2
  cat "${CAMPAIGN_RESPONSE_JSON}" >&2
  exit 1
fi

if [[ -z "${ONCHAIN_CAMPAIGN_ID}" || "${ONCHAIN_CAMPAIGN_ID}" == "null" ]]; then
  echo "API did not return onchain_campaign_id" >&2
  cat "${CAMPAIGN_RESPONSE_JSON}" >&2
  exit 1
fi

echo "==> API campaign created"
echo "    campaign_id:         ${CAMPAIGN_ID}"
echo "    onchain_campaign_id: ${ONCHAIN_CAMPAIGN_ID}"
echo "    eligible_root:       ${ELIGIBLE_ROOT}"

"${SCRIPT_DIR}/create_campaign.sh" \
  --protocol "${PROTOCOL_ADDRESS}" \
  --campaign-id "${ONCHAIN_CAMPAIGN_ID}" \
  --eligible-root "${ELIGIBLE_ROOT}" \
  --payout-wei "${PAYOUT_WEI}" \
  --funding-wei "${FUNDING_WEI}" \
  --message "${MESSAGE}" \
  --verifier "${VERIFIER_ADDRESS}" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}"

echo "==> Fetching Rust API claim payload"
curl -fsS \
  "${API_BASE_URL}/campaigns/${CAMPAIGN_ID}/claim/${RECIPIENT_ADDRESS}" > "${CLAIM_RESPONSE_JSON}"

echo "==> Writing Prover.toml from Rust API claim payload"
python3 - "${CLAIM_RESPONSE_JSON}" "${PROVER_PATH}" "${MESSAGE}" "${DEFAULT_STEALTH_TWEAK_HEX}" "${DEFAULT_DEMO_PRIVATE_KEY}" <<'PY'
import json
import sys
from pathlib import Path

claim_path, prover_path, message, stealth_tweak_hex, wallet_secret_hex = sys.argv[1:6]
claim = json.loads(Path(claim_path).read_text())

def bytes_to_decimal_list(hex_value: str):
    raw = bytes.fromhex(hex_value)
    return [str(byte) for byte in raw]

message_bytes = [str(byte) for byte in message.encode("ascii")]
stealth_tweak = bytes_to_decimal_list(stealth_tweak_hex)
wallet_secret = bytes_to_decimal_list(wallet_secret_hex)

eligible_index = claim["noir_inputs"]["eligible_index"]
eligible_path = claim["noir_inputs"]["eligible_path"]
eligible_root = claim["noir_inputs"]["eligible_root"]

lines = [
    f'eligible_index = "{eligible_index}"',
    "eligible_path = [" + ", ".join(f'"{value}"' for value in eligible_path) + "]",
    f'eligible_root = "{eligible_root}"',
    "message = [" + ", ".join(f'"{value}"' for value in message_bytes) + "]",
    "stealth_tweak = [" + ", ".join(f'"{value}"' for value in stealth_tweak) + "]",
    "wallet_secret = [" + ", ".join(f'"{value}"' for value in wallet_secret) + "]",
    "",
]

Path(prover_path).write_text("\n".join(lines))
PY

echo "==> Solving witness"
(
  cd "${CIRCUIT_DIR}"
  HOME=/tmp/codex-nargo-home \
  NARGO_HOME=/tmp/codex-nargo-home/.nargo \
  XDG_CACHE_HOME=/tmp/codex-nargo-home/.cache \
  nargo execute "${WITNESS_NAME}"
)

mkdir -p "${PROOF_DIR}"

echo "==> Generating proof"
BB_CRS_PATH="${BB_CRS_PATH}" \
bb prove -t evm \
  -b "${BYTECODE_PATH}" \
  -w "${WITNESS_PATH}" \
  -k "${VK_PATH}" \
  -o "${PROOF_DIR}" \
  --verify

"${SCRIPT_DIR}/claim_campaign.sh" \
  --protocol "${PROTOCOL_ADDRESS}" \
  --campaign-id "${ONCHAIN_CAMPAIGN_ID}" \
  --proof-file "${PROOF_DIR}/proof" \
  --public-inputs-file "${PROOF_DIR}/public_inputs" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}"

echo
echo "E2E API demo complete:"
echo "  test_name:            ${TEST_NAME}"
echo "  api_campaign_id:      ${CAMPAIGN_ID}"
echo "  onchain_campaign_id:  ${ONCHAIN_CAMPAIGN_ID}"
echo "  recipient_address:    ${RECIPIENT_ADDRESS}"
echo "  protocol_address:     ${PROTOCOL_ADDRESS}"
echo "  proof_dir:            ${PROOF_DIR}"
