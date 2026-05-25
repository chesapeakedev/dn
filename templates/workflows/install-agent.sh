#!/usr/bin/env bash
# Installs the agent harness declared in .github/dn/config.json.
# Used by canonical dn GitHub Actions workflows.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
CONFIG="${ROOT}/.github/dn/config.json"

if [ ! -f "${CONFIG}" ]; then
  echo "::error::Missing ${CONFIG}. Run: dn init workflows --agent <opencode|cursor|claude|codex>" >&2
  exit 1
fi

agent="$(jq -r '.agent // empty' "${CONFIG}")"
case "${agent}" in
  opencode | cursor | claude | codex) ;;
  *)
    echo "::error::Invalid agent in ${CONFIG}: ${agent}. Use opencode, cursor, claude, or codex." >&2
    exit 1
    ;;
esac

echo "Installing agent harness: ${agent}"

case "${agent}" in
  opencode)
    curl -fsSL https://opencode.dev/install | bash
    echo "${HOME}/.opencode/bin" >> "${GITHUB_PATH}"
    ;;
  claude)
    curl -fsSL https://claude.ai/install.sh | bash
    echo "${HOME}/.local/bin" >> "${GITHUB_PATH}"
    ;;
  cursor)
    curl https://cursor.com/install -fsS | bash
    echo "${HOME}/.cursor/bin" >> "${GITHUB_PATH}"
    ;;
  codex)
    npm install -g @openai/codex
    ;;
esac
