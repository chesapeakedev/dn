#!/bin/bash
# Sign and notarize a macOS dn binary for Gatekeeper.
#
# Usage (from repo root or any cwd):
#   ./scripts/macos_sign_and_notarize.sh <binary-path>
#
# Required environment variables:
#   APPLE_CERTIFICATE_BASE64   Base64-encoded Developer ID Application .p12
#   APPLE_CERTIFICATE_PASSWORD Password for the .p12
#   APPLE_API_KEY              Contents of the App Store Connect .p8 key
#   APPLE_API_KEY_ID           Key ID for the .p8
#   APPLE_API_ISSUER_ID        Issuer ID (UUID) for App Store Connect API
#
# Optional:
#   APPLE_SIGNING_IDENTITY     codesign identity string; defaults to the first
#                              "Developer ID Application" identity in the
#                              temporary keychain
#
# Exits non-zero if signing or notarization fails.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <binary-path>" >&2
  exit 1
fi

BINARY_PATH="$1"
if [[ ! -f "${BINARY_PATH}" ]]; then
  echo "Binary not found: ${BINARY_PATH}" >&2
  exit 1
fi

: "${APPLE_CERTIFICATE_BASE64:?APPLE_CERTIFICATE_BASE64 is required}"
: "${APPLE_CERTIFICATE_PASSWORD:?APPLE_CERTIFICATE_PASSWORD is required}"
: "${APPLE_API_KEY:?APPLE_API_KEY is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER_ID:?APPLE_API_ISSUER_ID is required}"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dn-macos-sign.XXXXXX")"
cleanup() {
  if [[ -n "${KEYCHAIN_PATH:-}" && -f "${KEYCHAIN_PATH}" ]]; then
    security delete-keychain "${KEYCHAIN_PATH}" 2>/dev/null || true
  fi
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

KEYCHAIN_PATH="${WORK_DIR}/signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
P12_PATH="${WORK_DIR}/certificate.p12"
API_KEY_PATH="${WORK_DIR}/AuthKey_${APPLE_API_KEY_ID}.p8"
ZIP_PATH="${WORK_DIR}/$(basename "${BINARY_PATH}").zip"
DEVELOPER_ID_G2_URL="https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"
DEVELOPER_ID_G2_PATH="${WORK_DIR}/DeveloperIDG2CA.cer"

echo "Preparing signing keychain..."
security create-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_PATH}"
security set-keychain-settings -lut 21600 "${KEYCHAIN_PATH}"
security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_PATH}"

echo -n "${APPLE_CERTIFICATE_BASE64}" | base64 --decode >"${P12_PATH}"
security import "${P12_PATH}" \
  -P "${APPLE_CERTIFICATE_PASSWORD}" \
  -A \
  -t cert \
  -f pkcs12 \
  -k "${KEYCHAIN_PATH}"

# Ensure the Developer ID G2 intermediate is present (needed for trust eval).
curl -fsSL "${DEVELOPER_ID_G2_URL}" -o "${DEVELOPER_ID_G2_PATH}"
security import "${DEVELOPER_ID_G2_PATH}" -k "${KEYCHAIN_PATH}" -T /usr/bin/codesign || true

security list-keychain -d user -s "${KEYCHAIN_PATH}" $(security list-keychain -d user | sed -e s/\"//g)
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "${KEYCHAIN_PASSWORD}" \
  "${KEYCHAIN_PATH}" >/dev/null

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  SIGN_IDENTITY="${APPLE_SIGNING_IDENTITY}"
else
  SIGN_IDENTITY="$(
    security find-identity -v -p codesigning "${KEYCHAIN_PATH}" |
      awk -F\" '/Developer ID Application/ { print $2; exit }'
  )"
fi

if [[ -z "${SIGN_IDENTITY}" ]]; then
  echo "No Developer ID Application identity found in keychain." >&2
  security find-identity -p codesigning "${KEYCHAIN_PATH}" >&2 || true
  exit 1
fi

echo "Signing ${BINARY_PATH} as ${SIGN_IDENTITY}..."
codesign --force --options runtime --timestamp \
  --sign "${SIGN_IDENTITY}" \
  "${BINARY_PATH}"
codesign --verify --verbose=2 "${BINARY_PATH}"

echo "Submitting ${BINARY_PATH} for notarization..."
printf '%s\n' "${APPLE_API_KEY}" >"${API_KEY_PATH}"
chmod 600 "${API_KEY_PATH}"

# Zip for notarytool; keepParent preserves a single-file archive layout.
ditto -c -k --keepParent "${BINARY_PATH}" "${ZIP_PATH}"

xcrun notarytool submit "${ZIP_PATH}" \
  --key "${API_KEY_PATH}" \
  --key-id "${APPLE_API_KEY_ID}" \
  --issuer "${APPLE_API_ISSUER_ID}" \
  --wait

# Stapling may fail for bare Mach-O CLIs; notarization ticket still applies online.
if xcrun stapler staple "${BINARY_PATH}"; then
  echo "Stapled notarization ticket to ${BINARY_PATH}"
else
  echo "Warning: stapler could not staple ${BINARY_PATH} (common for CLI binaries)." >&2
fi

echo "Signed and notarized: ${BINARY_PATH}"
