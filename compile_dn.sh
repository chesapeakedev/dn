#!/bin/bash
set -e

# Compile dn to standalone binary with included prompts
# Requires Deno 2.1 or later
# This script should be run from the dn repository root

DN_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KICKSTART_DIR="${DN_REPO_ROOT}/kickstart"
OUTPUT_NAME=".dn"

echo "Compiling dn with included system prompts..."
echo "  Source: ${DN_REPO_ROOT}/cli/main.ts"
echo "  Output: ${DN_REPO_ROOT}/${OUTPUT_NAME}"
echo "  Included files:"
echo "    - ${KICKSTART_DIR}/system.prompt.plan.md"
echo "    - ${KICKSTART_DIR}/system.prompt.implement.md"
echo "    - ${KICKSTART_DIR}/system.prompt.merge.md"
echo "    - ${KICKSTART_DIR}/system.prompt.fixup.md"
echo ""

cd "${DN_REPO_ROOT}"

deno compile \
  --allow-all \
  --config "${DN_REPO_ROOT}/deno.json" \
  --include "${KICKSTART_DIR}/system.prompt.plan.md" \
  --include "${KICKSTART_DIR}/system.prompt.implement.md" \
  --include "${KICKSTART_DIR}/system.prompt.merge.md" \
  --include "${KICKSTART_DIR}/system.prompt.fixup.md" \
  -o "${DN_REPO_ROOT}/${OUTPUT_NAME}" \
  "${DN_REPO_ROOT}/cli/main.ts"

echo ""
echo "✅ Compilation successful!"
echo "Binary created at: ${DN_REPO_ROOT}/${OUTPUT_NAME}"
