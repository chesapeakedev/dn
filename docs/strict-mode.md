# Strict mode (`dn.json`)

Strict mode is an **opt-in** project policy block in root `dn.json`. It is off
by default: repositories without a `strict` block behave exactly as before.

Use strict mode when a team wants lightweight guardrails around agent-driven
planning (`dn meld`, `dn kickstart`) without replacing GitHub branch protection
or access control.

## Configuration

```json
{
  "schema_version": "2.0",
  "strict": {
    "enabled": true,
    "require_rfcs": true,
    "linear_history": true,
    "path_gates": ["rfcs/**", "**/*.md"]
  }
}
```

| Field            | Enforced by `dn` today | Purpose                                                       |
| ---------------- | ---------------------- | ------------------------------------------------------------- |
| `enabled`        | Yes (master switch)    | When false or absent, other strict fields are ignored.        |
| `require_rfcs`   | Yes (with `enabled`)   | Block `dn kickstart` / `dn meld` without a usable RFC corpus. |
| `linear_history` | Documented only        | Team expectation for trunk history (see below).               |
| `path_gates`     | Documented only        | Suggested GitHub ruleset path filters (see below).            |

`dn init wizard --project` may persist `"strict": { "enabled": true }` without
`require_rfcs`. That remains compatible: only repos that explicitly set
`require_rfcs: true` get RFC corpus enforcement.

## `require_rfcs` policy

When **`strict.enabled`** and **`strict.require_rfcs`** are both true,
`dn kickstart` and `dn meld` **exit with a non-zero status** before invoking an
agent when either condition holds:

1. The RFC directory is missing (`rfcs/` by default, or `rfc.dir` in `dn.json`).
2. The corpus has **no non-draft RFC** — every RFC is still `draft`, or the
   directory/state index is empty.

At least one RFC must reach `review`, `accepted`, `implementing`, `done`, or
`superseded` before planning workflows run. Draft-only corpora are intentional
sketches; strict mode expects a promoted design anchor before automated
implementation planning.

Typical remediation:

```bash
dn rfc init
dn rfc create --title "Feature design"
dn rfc status 1 review
```

## Human vs machine boundary

Strict mode separates **what humans approve** from **what automation executes**:

- **Humans** own durable design (`dn rfc`), branch protection, rulesets, and
  merge decisions. RFC promotion beyond `draft` is a deliberate team signal.
- **Machines** (`dn kickstart`, Actions workflows, cloud agents) consume that
  signal. `require_rfcs` prevents agents from planning implementation when no
  accepted design corpus exists — reducing drive-by automation on repos that
  opted in.

`dn` does not grant GitHub permissions or enforce who may push; it validates
local/CI preconditions so automation fails fast with actionable errors instead
of silent drift.

## Recommended GitHub rulesets

Pair `dn.json` strict settings with repository rulesets on `main` (or your trunk
branch):

1. **Trusted automation push** — Allow GitHub Actions (and optionally bot
   accounts) to push to `main` for landed agent work, while most contributors
   use PRs. This matches `dn sync` / `make sync` trunk workflows and daily
   kickstart publishing.
2. **Optional path gates** — For contributors who should only touch docs or
   RFCs, add ruleset path filters aligned with `path_gates`, for example
   `rfcs/**` and `**/*.md`. Keep code paths (`**/*.ts`, `src/**`) behind full
   review requirements.
3. **Linear history (optional)** — When `linear_history: true` is set in
   `dn.json`, treat it as a team convention: prefer rebase-and-land (Sapling:
   `sl rebase -d main`, `make sync`; Git: rebase onto `main`) over merge commits
   on trunk. `dn` does not rewrite VCS history in this release; enforce linear
   history via rulesets (“Require linear history”) and local habit.

Adjust rulesets to your org: strict mode in `dn` is complementary, not a
substitute for GitHub access control.

## Related docs

- [`dn rfc`](subcommands.md#dn-rfc--manage-rfcs-request-for-comments-for-design-documents)
  — corpus layout and status transitions
- [GitHub Actions](github-actions.md) — tiered `dn.json` configuration in CI
- [`dn init wizard`](subcommands.md#dn-init-wizard--guided-first-run-setup) —
  optional strict toggle during project setup
