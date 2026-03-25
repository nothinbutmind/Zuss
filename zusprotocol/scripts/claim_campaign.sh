#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  claim_campaign.sh --protocol <address> --rpc-url <url> --private-key <key> [campaign id options] [proof options]

Options:
  --protocol <address>        Deployed ZusProtocol address
  --rpc-url <url>             RPC URL
  --private-key <key>         Signer private key
  --campaign-id <bytes32>     Onchain campaign id as 0x-prefixed bytes32
  --campaign-uuid <uuid>      Convenience input; converted to a zero-padded bytes32
  --proof-file <path>         Raw proof bytes file
  --public-inputs-file <path> Raw public inputs file
  -h, --help                  Show this help
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTOCOL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROTOCOL_ADDRESS=""
RPC_URL=""
PRIVATE_KEY=""
CAMPAIGN_ID=""
CAMPAIGN_UUID=""
PROOF_FILE="${PROTOCOL_DIR}/../verifier/generated/stealthdrop/proof_test/proof"
PUBLIC_INPUTS_FILE="${PROTOCOL_DIR}/../verifier/generated/stealthdrop/proof_test/public_inputs"

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
    --campaign-id)
      CAMPAIGN_ID="${2:-}"
      shift 2
      ;;
    --campaign-uuid)
      CAMPAIGN_UUID="${2:-}"
      shift 2
      ;;
    --proof-file)
      PROOF_FILE="${2:-}"
      shift 2
      ;;
    --public-inputs-file)
      PUBLIC_INPUTS_FILE="${2:-}"
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

if [[ -n "${CAMPAIGN_ID}" && -n "${CAMPAIGN_UUID}" ]]; then
  echo "Use either --campaign-id or --campaign-uuid, not both" >&2
  exit 1
fi

if [[ -z "${CAMPAIGN_ID}" && -z "${CAMPAIGN_UUID}" ]]; then
  echo "Either --campaign-id or --campaign-uuid is required" >&2
  exit 1
fi

if [[ ! "${PROTOCOL_ADDRESS}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid protocol address: ${PROTOCOL_ADDRESS}" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

if ! command -v xxd >/dev/null 2>&1; then
  echo "xxd is required" >&2
  exit 1
fi

if [[ ! -f "${PROOF_FILE}" ]]; then
  echo "Proof file not found: ${PROOF_FILE}" >&2
  exit 1
fi

if [[ ! -f "${PUBLIC_INPUTS_FILE}" ]]; then
  echo "Public inputs file not found: ${PUBLIC_INPUTS_FILE}" >&2
  exit 1
fi

CAMPAIGN_ID_HEX="$(
  python3 - "${CAMPAIGN_ID}" "${CAMPAIGN_UUID}" <<'PY'
import re
import sys

campaign_id = sys.argv[1].strip()
campaign_uuid = sys.argv[2].strip()

if campaign_id:
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", campaign_id):
        raise SystemExit("campaign id must be a 0x-prefixed bytes32")
    print(campaign_id)
else:
    if not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", campaign_uuid):
        raise SystemExit("campaign uuid must be a canonical UUID string")
    compact = campaign_uuid.replace("-", "").lower()
    print("0x" + ("0" * 32) + compact)
PY
)"

PROOF_HEX="0x$(xxd -p -c 999999 "${PROOF_FILE}")"
PUBLIC_INPUTS="[$(xxd -p -c 32 "${PUBLIC_INPUTS_FILE}" | sed 's/^/0x/' | paste -sd, -)]"

echo "==> Previewing claim"
cast call "${PROTOCOL_ADDRESS}" \
  'previewClaim(bytes32,bytes32[])((bytes32,bytes32,address,uint256,uint256,bool))' \
  "${CAMPAIGN_ID_HEX}" \
  "${PUBLIC_INPUTS}" \
  --rpc-url "${RPC_URL}"

echo "==> Sending claim transaction"
cast send "${PROTOCOL_ADDRESS}" \
  'claim(bytes32,bytes,bytes32[])(address)' \
  "${CAMPAIGN_ID_HEX}" \
  "${PROOF_HEX}" \
  "${PUBLIC_INPUTS}" \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}"
