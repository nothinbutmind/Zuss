#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  generate_shared_verifier.sh --circuit-dir <path> [--output-dir <path>] [--scheme <scheme>] [--oracle-hash <hash>] [--crs-path <path>] [--no-optimized]

Options:
  --circuit-dir   Noir circuit directory containing Nargo.toml
  --output-dir    Output directory for verifier artifacts
  --scheme        Barretenberg scheme (default: ultra_honk)
  --oracle-hash   Oracle hash for VK generation (default: keccak)
  --crs-path      CRS directory for Barretenberg (optional)
  --no-optimized  Disable optimized Solidity verifier generation
  -h, --help      Show this help
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

CIRCUIT_DIR=""
OUTPUT_DIR=""
SCHEME="ultra_honk"
ORACLE_HASH="keccak"
CRS_PATH="${BB_CRS_PATH:-}"
OPTIMIZED="1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --circuit-dir)
      CIRCUIT_DIR="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --scheme)
      SCHEME="${2:-}"
      shift 2
      ;;
    --oracle-hash)
      ORACLE_HASH="${2:-}"
      shift 2
      ;;
    --crs-path)
      CRS_PATH="${2:-}"
      shift 2
      ;;
    --no-optimized)
      OPTIMIZED="0"
      shift
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

NARGO_VERSION="$(nargo --version 2>/dev/null | sed -n 's/^nargo version = //p' | head -n1)"
BB_VERSION="$(bb --version 2>/dev/null || true)"

if [[ -z "${CIRCUIT_DIR}" ]]; then
  echo "--circuit-dir is required" >&2
  usage >&2
  exit 1
fi

CIRCUIT_DIR="$(cd "${CIRCUIT_DIR}" && pwd)"
NARGO_TOML="${CIRCUIT_DIR}/Nargo.toml"

if [[ ! -f "${NARGO_TOML}" ]]; then
  echo "Could not find Nargo.toml at ${NARGO_TOML}" >&2
  exit 1
fi

PACKAGE_NAME="$(awk -F '=' '/^name[[:space:]]*=/{gsub(/[ "]/,"",$2); print $2; exit}' "${NARGO_TOML}")"
if [[ -z "${PACKAGE_NAME}" ]]; then
  echo "Could not derive package name from ${NARGO_TOML}" >&2
  exit 1
fi

if [[ -z "${OUTPUT_DIR}" ]]; then
  OUTPUT_DIR="${VERIFIER_DIR}/generated/${PACKAGE_NAME}"
fi
mkdir -p "${OUTPUT_DIR}"

echo "==> Compiling Noir circuit: ${PACKAGE_NAME}"
(
  cd "${CIRCUIT_DIR}"
  nargo compile --skip-brillig-constraints-check
)

BYTECODE_PATH="${CIRCUIT_DIR}/target/${PACKAGE_NAME}.json"
VK_PATH="${OUTPUT_DIR}/vk"
VK_FILE_PATH="${VK_PATH}"
VERIFIER_SOL="${OUTPUT_DIR}/Verifier.sol"

if [[ ! -f "${BYTECODE_PATH}" ]]; then
  echo "Expected bytecode not found at ${BYTECODE_PATH}" >&2
  exit 1
fi

echo "==> Writing verification key"
BB_WRITE_VK_ARGS=(
  write_vk
  -s "${SCHEME}"
  -b "${BYTECODE_PATH}"
  -o "${VK_PATH}"
  --oracle_hash "${ORACLE_HASH}"
)

if [[ -n "${CRS_PATH}" ]]; then
  BB_WRITE_VK_ARGS+=(-c "${CRS_PATH}")
fi

set +e
BB_WRITE_VK_OUTPUT="$(
  bb "${BB_WRITE_VK_ARGS[@]}" 2>&1
)"
BB_WRITE_VK_STATUS=$?
set -e

printf '%s\n' "${BB_WRITE_VK_OUTPUT}"

if [[ ${BB_WRITE_VK_STATUS} -ne 0 ]]; then
  if grep -Eq 'Length is too large|Invalid gzip data' <<<"${BB_WRITE_VK_OUTPUT}"; then
    cat >&2 <<EOF

Verifier generation failed while Barretenberg was parsing the Noir bytecode artifact.
This usually means the installed \`bb\` binary is not compatible with the bytecode
format emitted by your current \`nargo\` / \`noirc\`.

Detected tool versions:
  nargo: ${NARGO_VERSION:-unknown}
  bb:    ${BB_VERSION:-unknown}

Recommended fix:
  1. Install a \`bb\` version matched to your Noir version, for example:
       bbup -nv "${NARGO_VERSION:-<your-noir-version>}"
  2. Or switch \`nargo\` / \`noirc\` to a version that matches your installed \`bb\`.

After aligning the toolchain, re-run:
  ./verifier/scripts/generate_shared_verifier.sh --circuit-dir "${CIRCUIT_DIR}"
EOF
  fi

  exit "${BB_WRITE_VK_STATUS}"
fi

if [[ -d "${VK_PATH}" && -f "${VK_PATH}/vk" ]]; then
  VK_FILE_PATH="${VK_PATH}/vk"
fi

echo "==> Writing Solidity verifier"
BB_VERIFIER_ARGS=(
  write_solidity_verifier
  -s "${SCHEME}"
  -k "${VK_FILE_PATH}"
  -o "${VERIFIER_SOL}"
)

if [[ -n "${CRS_PATH}" ]]; then
  BB_VERIFIER_ARGS+=(-c "${CRS_PATH}")
fi

if [[ "${OPTIMIZED}" == "1" ]]; then
  BB_VERIFIER_ARGS+=(--optimized)
fi

bb "${BB_VERIFIER_ARGS[@]}"

cat <<EOF

Shared verifier artifacts generated.

Package:        ${PACKAGE_NAME}
Circuit dir:    ${CIRCUIT_DIR}
Bytecode path:  ${BYTECODE_PATH}
VK path:        ${VK_PATH}
VK file path:   ${VK_FILE_PATH}
CRS path:       ${CRS_PATH:-"(bb default)"}
Verifier sol:   ${VERIFIER_SOL}

Next step:
  ./verifier/scripts/deploy_shared_verifier.sh \\
    --verifier-sol "${VERIFIER_SOL}" \\
    --contract-name ZusVerifier \\
    --rpc-url "\$RPC_URL" \\
    --private-key "\$PRIVATE_KEY"
EOF
