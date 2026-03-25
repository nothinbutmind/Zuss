#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  call_proof.sh [--address <verifier>] [--rpc-url <url>] [--proof-file <path>] [--public-inputs-file <path>]

Options:
  --address             Verifier contract address
  --rpc-url             RPC URL for the chain
  --proof-file          Path to the raw proof bytes file
  --public-inputs-file  Path to the raw public inputs file
  -h, --help            Show this help

Environment overrides:
  ZUS_VERIFIER_ADDRESS
  RPC_URL
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERIFIER_ADDRESS="${ZUS_VERIFIER_ADDRESS:-}"
RPC_URL="${RPC_URL:-https://testnet.evm.nodes.onflow.org}"
PROOF_FILE="${VERIFIER_DIR}/generated/stealthdrop/proof_test/proof"
PUBLIC_INPUTS_FILE="${VERIFIER_DIR}/generated/stealthdrop/proof_test/public_inputs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --address)
      VERIFIER_ADDRESS="${2:-}"
      shift 2
      ;;
    --rpc-url)
      RPC_URL="${2:-}"
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

if ! command -v cast >/dev/null 2>&1; then
  echo "cast is required" >&2
  exit 1
fi

if [[ -z "${VERIFIER_ADDRESS}" ]]; then
  echo "Verifier address is required. Pass --address or set ZUS_VERIFIER_ADDRESS." >&2
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

PROOF_HEX="0x$(xxd -p -c 999999 "${PROOF_FILE}")"
PUBLIC_INPUTS="[$(xxd -p -c 32 "${PUBLIC_INPUTS_FILE}" | sed 's/^/0x/' | paste -sd, -)]"

cast call "${VERIFIER_ADDRESS}" \
  'verify(bytes,bytes32[])(bool)' \
  "${PROOF_HEX}" \
  "${PUBLIC_INPUTS}" \
  --rpc-url "${RPC_URL}"
