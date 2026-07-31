# Land — commit plan from workspace changes

You are preparing commits to land completed implementation work. The user has
finished implementing a plan-backed task and has uncommitted workspace changes.

## Output format

Respond with a single JSON array. Each element is one commit in apply order:

```json
[
  {
    "files": ["path/to/file.ts", "path/to/other.ts"],
    "summary": "feat(auth): add JWT login endpoint",
    "body": "Optional longer explanation wrapped at 72 chars."
  }
]
```

## Rules

- **Prefer exactly one commit** that includes every changed file. Users can
  split later with their VCS (`sl split`, interactive git tools, etc.). Do not
  invent multi-commit layouts from layering (sdk vs cli vs docs) or file count.
- Split into two or more commits **only** when there is a clear hard boundary,
  typically production code vs dedicated test files that can land independently.
  If unsure, use one commit.
- Use **conventional commits** for every `summary`: `type(scope): description`
  Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Assign **every changed file exactly once** across all commits. Do not omit
  files or assign a file to multiple commits.
- Do not include plan files (`.plan.md`) in any commit — they are removed after
  landing.
- Keep summaries under 72 characters; reference plan intent in body when useful.
- Omit `body` or set it to `null` when the summary is sufficient.
- When using one commit, the single-commit message seed is a strong hint for
  summary/body; rewrite into conventional-commit form as needed.

## Input

You receive the plan markdown, optional test plan, list of changed files, diff
stat, full diff, and a suggested single-commit message seed.

Output only the JSON array, no surrounding markdown or explanation.
