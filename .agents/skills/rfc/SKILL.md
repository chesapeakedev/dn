---
name: rfc
description: Use when turning a greenfield idea into an initial RFC set, writing RFCs, or designing a system. Guides interview → overview → ordered RFC proposals → dn rfc writes. Do NOT implement product code.
---

# RFC authoring

Turn a greenfield idea or design question into a durable **5–15 RFC corpus** in
`rfcs/`. RFCs capture **why** and **how**; use `plans/` only for single-issue
execution.

## Triggers

Use this skill when the user asks to:

- design a system or architecture from scratch
- write RFCs or a design doc corpus
- bootstrap durable design decisions before implementation

## Workflow

1. **Interview** — clarify goal, boundaries, constraints, and non-goals
2. **Initialize** — run `dn rfc init` if `rfcs/` is missing
3. **Overview** — draft or refine `000-overview.md` (scope, glossary, RFC index)
4. **Propose** — list 5–15 ordered RFC titles with one-line rationale each
5. **Write** — create each RFC with `dn rfc create` and fill decision-focused
   bodies
6. **Review** — set statuses to `review` (or leave `draft`) for human review

## `dn rfc` commands

```bash
dn rfc init
dn rfc create --title "Descriptive Title" [--slug custom-slug] [--github-issue URL]
dn rfc list [--status draft|review|accepted|implementing|done|superseded] [--json]
dn rfc show <id|slug|path>
dn rfc status <id|slug|path> <status>
dn rfc complete <id>    # shortcut for status done
```

Status flow: `draft` → `review` → `accepted` → `implementing` → `done` (or
`superseded`).

Install this skill:

```bash
dn init agents --skill rfc --agent opencode
```

First-run project setup (optional):

```bash
dn init wizard --project
```

## STOP conditions

- **Do not implement product code** — RFC authoring only
- **Do not invent a parallel tracker** — use `dn rfc` and `rfcs/`, not ad-hoc
  docs
- **Keep RFCs short and decision-focused** — prefer bullets over essays
- **Do not overwrite human-edited RFCs** without explicit approval
- Leave statuses at `draft` or `review` unless the user asks to accept

## Related

- Default dn skill — consult `dn rfc list` / read `rfcs/` before large design
  work
- `plans/` — execution plans for GitHub issues, not durable design
