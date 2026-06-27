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

- Use **conventional commits** for every `summary`: `type(scope): description`
  Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Assign **every changed file exactly once** across all commits. Do not omit
  files or assign a file to multiple commits.
- Do not include plan files (`.plan.md`) in any commit — they are removed after
  landing.
- Group logically: separate feat vs test vs docs when the diff spans concerns.
- Keep summaries under 72 characters; reference plan intent in body when useful.
- Order commits so dependencies come first (e.g. core change before tests that
  depend on it).

## Input

You receive the plan markdown, optional test plan, list of changed files, diff
stat, and a suggested single-commit message seed. The seed is a hint only; split
and rewrite for conventional commits when landing multiple commits.

Output only the JSON array, no surrounding markdown or explanation.
