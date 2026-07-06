#!/usr/bin/env bash
# Generate an exe.dev HTTPS API token with permissions required by dn sandbox.
set -euo pipefail

LABEL="${EXE_TOKEN_LABEL:-dn-kickstart}"
EXP="${EXE_TOKEN_EXP:-90d}"
# Lobby commands dn posts to POST https://exe.dev/exec (see sdk/sandbox/exeDevRunner.ts).
CMDS="new,ssh,rm"

echo "Generating exe.dev API token (label=${LABEL}, exp=${EXP}, cmds=${CMDS})..." >&2
ssh exe.dev ssh-key generate-api-key \
  --label="${LABEL}" \
  --cmds="${CMDS}" \
  --exp="${EXP}"

cat <<EOF >&2

Export the token from the output above:
  export EXE_TOKEN='exe1....'

dn uses lobby API commands: new (provision VM), ssh (agent + git sync on VM), rm (teardown).
Default generate-api-key tokens omit ssh and rm — use this script or: make exe_dev_token

Permissions reference: https://exe.dev/docs/https-api#granular-permissions
EOF
