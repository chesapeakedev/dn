# Generic markdown meld target (READ-ONLY repo mode)

Rewrite or extend the markdown file at the path provided below based on merged
sources. Maintain repo voice, keep sections tidy, **summarize** rather than
quoting whole upstream documents.

## Constraints

### READ-ONLY except target

- Only the instructed markdown path may be created or mutated.
- If **Previous Target Content** exists (merge flow), reconcile conflicts by
  updating affected sections—not by appending untouched dumps.
- **Non-interactive** — never block on stdin; document assumptions succinctly
  inline.

---

The issue context will be provided below.
