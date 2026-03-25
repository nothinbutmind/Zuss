#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  create_campaign.sh --protocol <address> --rpc-url <url> --private-key <key> --payout-wei <wei> --eligible-root <root> [options]

Options:
  --protocol <address>      Deployed ZusProtocol address
  --rpc-url <url>           RPC URL
  --private-key <key>       Signer private key
  --campaign-id <bytes32>   Onchain campaign id as 0x-prefixed bytes32
  --campaign-uuid <uuid>    Convenience input; converted to a zero-padded bytes32
  --verifier <address>      Shared verifier address
  --eligible-root <value>   Decimal field value or 0x-prefixed bytes32 root
  --message <ascii>         Exactly 8 ASCII bytes (default: ZUSMVP01)
  --payout-wei <wei>        Fixed payout per successful claim
  --funding-wei <wei>       Initial campaign funding sent with createCampaign
  -h, --help                Show this help
EOF
}

DEFAULT_VERIFIER="${ZUS_VERIFIER_ADDRESS:-}"
DEFAULT_MESSAGE="ZUSMVP01"

PROTOCOL_ADDRESS=""
RPC_URL=""
PRIVATE_KEY=""
CAMPAIGN_ID=""
CAMPAIGN_UUID=""
VERIFIER_ADDRESS="${DEFAULT_VERIFIER}"
ELIGIBLE_ROOT=""
MESSAGE="${DEFAULT_MESSAGE}"
PAYOUT_WEI=""
FUNDING_WEI="0"

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
    --verifier)
      VERIFIER_ADDRESS="${2:-}"
      shift 2
      ;;
    --eligible-root)
      ELIGIBLE_ROOT="${2:-}"
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

if [[ -z "${PROTOCOL_ADDRESS}" || -z "${RPC_URL}" || -z "${PRIVATE_KEY}" || -z "${ELIGIBLE_ROOT}" || -z "${PAYOUT_WEI}" ]]; then
  echo "--protocol, --rpc-url, --private-key, --eligible-root, and --payout-wei are required" >&2
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

if [[ ! "${VERIFIER_ADDRESS}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid verifier address: ${VERIFIER_ADDRESS}. Pass --verifier or set ZUS_VERIFIER_ADDRESS." >&2
  exit 1
fi

if [[ ! "${PAYOUT_WEI}" =~ ^[0-9]+$ ]]; then
  echo "--payout-wei must be a base-10 integer" >&2
  exit 1
fi

if [[ ! "${FUNDING_WEI}" =~ ^[0-9]+$ ]]; then
  echo "--funding-wei must be a base-10 integer" >&2
  exit 1
fi

if [[ "${#MESSAGE}" -ne 8 ]]; then
  echo "--message must be exactly 8 ASCII bytes for the current circuit" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
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

MESSAGE_HEX="$(
  python3 - "${MESSAGE}" <<'PY'
import sys
message = sys.argv[1]
raw = message.encode("ascii")
if len(raw) != 8:
    raise SystemExit("message must be exactly 8 ASCII bytes")
print("0x" + raw.hex())
PY
)"

ELIGIBLE_ROOT_HEX="$(
  python3 - "${ELIGIBLE_ROOT}" <<'PY'
import sys
value = sys.argv[1].strip()
if value.startswith(("0x", "0X")):
    hex_value = value[2:]
    if len(hex_value) > 64:
        raise SystemExit("eligible root hex is longer than bytes32")
    number = int(hex_value, 16)
else:
    number = int(value, 10)
if number < 0 or number >= 1 << 256:
    raise SystemExit("eligible root must fit into bytes32")
print("0x" + number.to_bytes(32, "big").hex())
PY
)"

echo "==> Creating campaign on ZusProtocol"
SEND_OUTPUT="$(
  cast send "${PROTOCOL_ADDRESS}" \
    'createCampaign(bytes32,address,bytes32,bytes8,uint256)' \
    "${CAMPAIGN_ID_HEX}" \
    "${VERIFIER_ADDRESS}" \
    "${ELIGIBLE_ROOT_HEX}" \
    "${MESSAGE_HEX}" \
    "${PAYOUT_WEI}" \
    --value "${FUNDING_WEI}" \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}" 2>&1
)" || {
  printf '%s\n' "${SEND_OUTPUT}" >&2
  exit 1
}
printf '%s\n' "${SEND_OUTPUT}"

echo
echo "Campaign created:"
echo "  protocol:      ${PROTOCOL_ADDRESS}"
echo "  campaign_id:   ${CAMPAIGN_ID_HEX}"
echo "  verifier:      ${VERIFIER_ADDRESS}"
echo "  eligible_root: ${ELIGIBLE_ROOT_HEX}"
echo "  message:       ${MESSAGE_HEX} (${MESSAGE})"
echo "  payout_wei:    ${PAYOUT_WEI}"
echo "  funding_wei:   ${FUNDING_WEI}"
