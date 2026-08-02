#!/bin/bash
set -e

# Compile dn to standalone binary with included prompts and workflow templates.
# Requires Deno 2.1 or later. Run from the dn repository root.
#
# Usage:
#   ./compile_dn.sh
#   ./compile_dn.sh -o dn-linux-x64 --target x86_64-unknown-linux-gnu

DN_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KICKSTART_DIR="${DN_REPO_ROOT}/kickstart"
WORKFLOW_TEMPLATE_DIR="${DN_REPO_ROOT}/templates/workflows"
OUTPUT_NAME="bin/dn"
TARGET=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Compile dn with embedded kickstart prompts and workflow templates.

Options:
  -o, --output PATH   Output binary path (default: bin/dn in repo root)
  --target TRIPLE     Cross-compile target (e.g. x86_64-unknown-linux-gnu)
  -h, --help          Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output)
      OUTPUT_NAME="$2"
      shift 2
      ;;
    --target)
      TARGET="$2"
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

if [[ "${OUTPUT_NAME}" == /* ]]; then
  OUTPUT_PATH="${OUTPUT_NAME}"
else
  OUTPUT_PATH="${DN_REPO_ROOT}/${OUTPUT_NAME}"
fi

OUTPUT_DIR="$(dirname "${OUTPUT_PATH}")"
mkdir -p "${OUTPUT_DIR}"

echo "Compiling dn with included system prompts and workflow templates..."
echo "  Source: ${DN_REPO_ROOT}/cli/main.ts"
echo "  Output: ${OUTPUT_PATH}"
if [ -n "${TARGET}" ]; then
  echo "  Target: ${TARGET}"
fi
echo "  Included files:"
echo "    - ${KICKSTART_DIR}/system.prompt.plan.md"
echo "    - ${KICKSTART_DIR}/system.prompt.prep.md"
echo "    - ${KICKSTART_DIR}/system.prompt.prep.milestone.md"
echo "    - ${KICKSTART_DIR}/system.prompt.implement.md"
echo "    - ${KICKSTART_DIR}/system.prompt.merge.md"
echo "    - ${KICKSTART_DIR}/system.prompt.fixup.md"
echo "    - ${KICKSTART_DIR}/system.prompt.score.md"
echo "    - ${KICKSTART_DIR}/system.prompt.land.md"
echo "    - ${KICKSTART_DIR}/system.prompt.testplan.md"
echo "    - ${KICKSTART_DIR}/system.prompt.complexity.md"
echo "    - ${KICKSTART_DIR}/system.prompt.meld.github-issue.md"
echo "    - ${KICKSTART_DIR}/system.prompt.meld.github-comment.md"
echo "    - ${KICKSTART_DIR}/system.prompt.meld.readme.md"
echo "    - ${KICKSTART_DIR}/system.prompt.meld.contributing.md"
echo "    - ${KICKSTART_DIR}/system.prompt.meld.agents.md"
echo "    - ${KICKSTART_DIR}/system.prompt.meld.markdown.md"
echo "    - ${KICKSTART_DIR}/kickstart.mdc"
echo "    - ${WORKFLOW_TEMPLATE_DIR}/manifest.json"
echo "    - ${WORKFLOW_TEMPLATE_DIR}/dn-init-stack.yml"
echo "    - ${WORKFLOW_TEMPLATE_DIR}/dn-meld-issue-plan.yml"
echo "    - ${WORKFLOW_TEMPLATE_DIR}/dn-kickstart-issue.yml"
echo "    - ${WORKFLOW_TEMPLATE_DIR}/dn-daily-kickstart.yml"
echo "    - ${WORKFLOW_TEMPLATE_DIR}/install-agent.sh"
echo ""

cd "${DN_REPO_ROOT}"

COMPILE_ARGS=(
  --allow-all
  --config "${DN_REPO_ROOT}/deno.json"
  --include "${KICKSTART_DIR}/system.prompt.plan.md"
  --include "${KICKSTART_DIR}/system.prompt.prep.md"
  --include "${KICKSTART_DIR}/system.prompt.prep.milestone.md"
  --include "${KICKSTART_DIR}/system.prompt.implement.md"
  --include "${KICKSTART_DIR}/system.prompt.merge.md"
  --include "${KICKSTART_DIR}/system.prompt.fixup.md"
  --include "${KICKSTART_DIR}/system.prompt.score.md"
  --include "${KICKSTART_DIR}/system.prompt.land.md"
  --include "${KICKSTART_DIR}/system.prompt.testplan.md"
  --include "${KICKSTART_DIR}/system.prompt.complexity.md"
  --include "${KICKSTART_DIR}/system.prompt.meld.github-issue.md"
  --include "${KICKSTART_DIR}/system.prompt.meld.github-comment.md"
  --include "${KICKSTART_DIR}/system.prompt.meld.readme.md"
  --include "${KICKSTART_DIR}/system.prompt.meld.contributing.md"
  --include "${KICKSTART_DIR}/system.prompt.meld.agents.md"
  --include "${KICKSTART_DIR}/system.prompt.meld.markdown.md"
  --include "${KICKSTART_DIR}/kickstart.mdc"
  --include "${WORKFLOW_TEMPLATE_DIR}/manifest.json"
  --include "${WORKFLOW_TEMPLATE_DIR}/dn-init-stack.yml"
  --include "${WORKFLOW_TEMPLATE_DIR}/dn-meld-issue-plan.yml"
  --include "${WORKFLOW_TEMPLATE_DIR}/dn-kickstart-issue.yml"
  --include "${WORKFLOW_TEMPLATE_DIR}/dn-daily-kickstart.yml"
  --include "${WORKFLOW_TEMPLATE_DIR}/install-agent.sh"
)

if [ -n "${TARGET}" ]; then
  COMPILE_ARGS+=(--target "${TARGET}")
fi

COMPILE_ARGS+=(-o "${OUTPUT_PATH}" "${DN_REPO_ROOT}/cli/main.ts")

deno compile "${COMPILE_ARGS[@]}"

echo ""
echo "Compilation successful!"
echo "Binary created at: ${OUTPUT_PATH}"
