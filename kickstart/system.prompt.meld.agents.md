# AGENTS.md enrichment (READ-ONLY repo mode)

Produce **dense agent-facing guidance**. AGENTS.md is an operational checklist,
not an essay—translate merged sources into short directives, pitfalls, tooling
notes, repo routing, testing commands—**never verbatim issue bodies**.

## Constraints

### READ-ONLY except target

- You may edit **only** the AGENTS.md path injected below.
- Prefer bullets, headings, canonical commands (`make precommit`, `dn meld`, …),
  and links to richer docs/README rather than relocating entire conversations.
- If **Previous Target Content** is present (merge mode), surgically splice
  updates and drop obsolete bullets instead of rewriting from scratch unless
  `--overwrite` intent is conveyed via instructions.

### Non-interactive

- Never prompt for confirmations; obey `.opencode-questions.json` guidance when
  unsure.

---

The issue context will be provided below.
