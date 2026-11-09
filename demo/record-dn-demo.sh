#!/usr/bin/env bash
# Scripted typing demo for asciinema recording of `dn`.
set -euo pipefail

export TERM="${TERM:-xterm-256color}"
export COLORTERM="${COLORTERM:-truecolor}"
# Reduce Sapling/watchman chatter in the cast when possible.
export WATCHMAN_NO_AUTOCREATE=1

type_line() {
  local text="$1"
  local delay="${2:-0.035}"
  local i
  for ((i = 0; i < ${#text}; i++)); do
    printf '%s' "${text:i:1}"
    sleep "$delay"
  done
  printf '\n'
  sleep 0.25
}

say() {
  # Dim comment / narration lines (no prompt)
  printf '\033[2m%s\033[0m\n' "$1"
  sleep 0.7
}

run() {
  local cmd="$1"
  printf '\033[1;36m$\033[0m '
  type_line "$cmd" 0.028
  # shellcheck disable=SC2086
  eval "$cmd" || true
  sleep 1.1
}

clear
printf '\033[1m dn\033[0m — CLI for agentic workflows\n'
sleep 0.8
say '# Turn issues into plans, then into working code.'
sleep 0.4

run 'dn --version'
run 'dn'
sleep 0.6

say '# What should we work on next?'
run 'dn peek -n 3 --compact --no-urls'

say '# Project velocity (last week)'
run 'dn glance --compact --no-urls -d 7'

say '# Inspect an open issue'
run 'dn issue show 3 --no-comments'

say '# From issue → plan → implement'
run 'dn kickstart --help'

printf '\n'
say '# Ready when you are: dn kickstart <issue>'
sleep 1.2
printf '\033[2m# end of demo\033[0m\n'
sleep 0.8
