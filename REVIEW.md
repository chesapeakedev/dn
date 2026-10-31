# Kickstart review pass

After the main implement phase, apply a **review refinement** pass on the
working tree changes. Treat this as a second implement pass focused on quality,
not a separate audit-only step.

## Focus

- Match existing code style, naming, and error-handling patterns in touched
  files.
- Prefer minimal diffs; do not refactor unrelated code.
- Confirm acceptance criteria in the plan file are accurately checked off.
- Run or reason about `make lint` expectations for changed areas.
- Add or adjust tests when behavior changed and tests are in scope for the
  issue.

## Out of scope

- Do not commit, push, or run `dn land` / `dn sync` unless explicitly asked.
- Do not edit `*.plan.md` unless the plan checklist needs correction.
