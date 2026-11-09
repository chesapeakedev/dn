# Outer IDE harness contract

Cursor, Claude Code, Codex, and similar chat sessions are the **outer harness**.
`dn` is a CLI subagent for research, optional implement (`loop`), publish
(`sync`), and closeout (`task done`). Device runners and unattended terminals
are **dn-outer**.

## SDLC tiers (pick one)

| Tier            | When                             | Flow                                                                                                                                                                                                                  |
| --------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A (default)** | Agent edits the repo in the IDE  | Optional `dn research <url>` → plan + implement in chat → **follow-ups** (ask before filing via `dn task create`) → **commit in the IDE** (ask first) → optional `dn sync` → `dn task done --denoise\|--github <url>` |
| **B**           | Delegate implement to `dn` only  | `dn research` → plan in the IDE (never `dn meld`) → `dn loop <url>` or `dn loop <plan-path>` → review diff → commit in the IDE → optional `dn sync` → `dn task done`                                                  |
| **C**           | No IDE; full pipeline from a URL | **`dn kickstart <url>`** (preferred). Stepwise: `dn meld` → `dn loop` → `dn land` / `dn sync` when you need phase boundaries                                                                                          |

**IDE rule:** never run `dn meld` when the IDE is outer. Use `dn research` for
ticket + repo pointers; the harness owns the plan.

**Closeout:** `dn task done` is the **Done** verb (not `dn land`). `dn land`
does not close tickets.

## When to use `dn land` vs IDE commit

| Situation                                           | Use `dn land`?                                                |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Cursor / Claude / Codex after `dn loop`             | **No** — commit in the harness with user approval             |
| Work already committed in the IDE                   | **No** — `dn sync` / `dn task done` only                      |
| Denoise UI **Land** on a device runner              | **Yes**                                                       |
| Terminal after kickstart/loop with `--publish none` | **Yes**, if the user wants dn’s review + plan-derived commits |
| CI, `--single`, RFC land, user asks for `dn land`   | **Yes**                                                       |

## Shared vocabulary

Research → Plan → Implement → Commit → Publish → Done map to `dn research`, IDE
plan, implement (IDE or `loop`), IDE commit or `dn land`, `dn sync`, and
`dn task done`. **Follow-ups:** list deferred work → ask → `dn task` /
`dn issue` create when the user approves (outer harness only; do not auto-file).
