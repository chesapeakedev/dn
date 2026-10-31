#!/usr/bin/env bash
# Installs the agent harness declared in repository dn.json.
# Used by canonical dn GitHub Actions workflows.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
CONFIG="${ROOT}/dn.json"

if [ ! -f "${CONFIG}" ]; then
  echo "::error::Missing ${CONFIG}. Set harness.defaults.agent in dn.json (or legacy top-level agent)." >&2
  exit 1
fi

agent="$(jq -r '.harness.defaults.agent // .agent // empty' "${CONFIG}")"
case "${agent}" in
  opencode | cursor | claude | codex | copilot) ;;
  *)
    echo "::error::Invalid agent in ${CONFIG}: ${agent}. Use opencode, cursor, claude, codex, or copilot." >&2
    exit 1
    ;;
esac

echo "Installing agent harness: ${agent}"

case "${agent}" in
  opencode)
    curl -fsSL https://opencode.ai/install | bash
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
  copilot)
    echo "::error::Copilot agent install is not supported in install-agent.sh; configure the runner image instead." >&2
    exit 1
    ;;
esac
