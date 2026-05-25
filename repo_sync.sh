#!/usr/bin/env bash
# Deprecated wrapper: canonical entry points are `make sync` / `dn sync`.
set -euo pipefail
_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec deno run --allow-all "${_script_dir}/cli/main.ts" sync "$@"
