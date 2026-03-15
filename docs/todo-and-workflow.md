# Todo list, scoring, and multi-ticket workflow

This document describes the prioritized todo list (`~/.dn/todo.md`), how it
integrates with `dn kickstart` and `dn tidy`, and a **recommended workflow** for
closing multiple tickets in one sitting.

## What’s implemented

- **`~/.dn/todo.md`** — User-level list: YAML frontmatter (`repo`, `updated`) +
  checklist lines (`- [ ]` / `- [x]`, optional score, ref, title). Ref = GitHub
  issue URL/number or path (e.g. `plans/foo.plan.md`).
- **`dn todo done [ref]`** — Marks the first unchecked item (or the item
  matching `ref`) as done and **closes the GitHub issue** when the ref is an
  issue; path refs only update the file.
- **`dn kickstart` with no ticket** — Prompts: “Suggest a task from your list?”
  → if list has items, suggests first unchecked and asks “Proceed with …?”; if
  list empty, “Search this repo?” → fetches 5 open issues + `plans/*.plan.md`,
  **scores** them (Fibonacci 1–8), writes todo, then suggests first.
- **`dn tidy`** — Re-fetches open issues + plans, re-scores, updates
  `~/.dn/todo.md`; if the scorer suggests merges, prompts for confirmation
  before creating/closing issues.
- **Scoring** — Single LLM call (same agent as plan phase), Fibonacci scores,
  disqualify low-info issues; prompt is bundled in the compiled binary like
  other kickstart prompts.

## Recommended workflow: close multiple tickets in one sitting

Use this flow when you want to **batch** tickets in a single session with
minimal context-switching.

### 1. Start of session (optional): seed or refresh the list

```bash
# From the repo you’ll work in
cd /path/to/your/repo
dn tidy
```

- Fetches recent open issues + any `plans/*.plan.md`, scores them, and
  writes/updates `~/.dn/todo.md` in priority order (easiest first).
- Run once at the start of the day or when you want a fresh ordering. You can
  skip this if your list is already up to date.

### 2. Run kickstart in a loop (no ticket needed)

```bash
dn kickstart
```

- When you don’t pass a ticket, `dn` will:
  1. Ask: “Suggest a task from your list?” → **y**
  2. If the list is empty: “Search this repo?” → **y** → fetches 5 issues +
     plans, scores, writes todo, then suggests first.
  3. Show the first unchecked item and ask: “Proceed with &lt;ref&gt;?” → **y**
  4. Run the full kickstart (plan + implement) for that ref.

After kickstart finishes (success or you stop), run **the same command again**
to do the next ticket:

```bash
dn kickstart
# y → y (or just y if list already has items) → next ticket
```

Repeat as long as you want to keep going. No need to look up issue numbers or
paths; the list is already ordered by “kickstart readiness.”

### 3. Mark work as done and close issues

When you’re satisfied with a ticket (e.g. PR merged or you’re done with that
task):

```bash
dn todo done
```

- Marks the **first unchecked** item in `~/.dn/todo.md` as done.
- If that item is a GitHub issue, **closes the issue** with a comment
  (“Completed via dn todo done”).
- To mark a specific item: `dn todo done 42` or
  `dn todo done https://github.com/owner/repo/issues/42`.

So in practice you can alternate:

- `dn kickstart` → implement next from list
- (review, merge, etc.)
- `dn todo done` → mark that one done and close the issue
- `dn kickstart` → next

### 4. Weaving into what you’re already doing

- **You already run kickstart with a ticket**
  - Keep doing: `dn kickstart 123` or `dn kickstart https://...`.
  - Optional: after a run, add that ticket (or the next one) to the list for
    later: edit `~/.dn/todo.md` or use a future “add to todo” hook from other
    commands.

- **You already run prep then loop**
  - `dn prep 123` → plan file in `plans/`.
  - If you use `dn tidy` or “suggest from list” later, `plans/*.plan.md` are
    included as virtual tickets and scored with issues.
  - So: prep one or more issues → later `dn kickstart` (no args) can suggest
    those plans plus open issues.

- **You want to see what’s on the list**
  - Open `~/.dn/todo.md` in your editor, or run a future `dn todo list` if
    added.
  - First unchecked line is what `dn kickstart` (no args) will suggest next.

- **You’re in a different repo**
  - Todo is global (`~/.dn/todo.md`). If the first unchecked item is for another
    repo, use `dn kickstart --allow-cross-repo` when that item is suggested, or
    reorder/edit the file so the current repo’s items are first.

## Quick reference

| Goal                        | Command / action                         |
| --------------------------- | ---------------------------------------- |
| Refresh list from this repo | `dn tidy`                                |
| Do next ticket (suggested)  | `dn kickstart` → y → y                   |
| Do a specific ticket        | `dn kickstart 123` or `dn kickstart URL` |
| Mark current done + close   | `dn todo done`                           |
| Mark specific done + close  | `dn todo done 42` or `dn todo done URL`  |
| Edit list by hand           | Edit `~/.dn/todo.md`                     |

---

## Review vs plan and improvement ideas

The implementation matches the plan: todo storage, frontmatter, lock,
`todo done` (with issue close), scoring (Fibonacci, one LLM call), kickstart
no-ticket flow (suggest from list or search + score), and `dn tidy` with merge
confirmation. Below are **improvements** that would sharpen the experience for
“close multiple tickets in quick succession.”

### 1. Fewer prompts for the “next ticket” flow

**Today:** No ticket → “Suggest from list?” (y) → “Proceed with &lt;ref&gt;?”
(y) → kickstart. Two prompts every time.

**Idea:** Single prompt, or skip when unambiguous:

- **Single prompt:** e.g. “Use first: #42 Add login flow? (y/n/skip).” One
  answer.
- **Non-interactive / batch:** `dn kickstart --yes` or `dn kickstart --next`:
  use first unchecked without prompting (for scripting or “run and walk away”).
- **Default to first:** If there’s exactly one unchecked item, default to
  “Proceed? (Y/n)” so Enter means “yes.”

Reduces friction when repeating “next ticket” many times in a row.

### 2. Post-kickstart: “Mark done and continue?”

**Today:** After kickstart finishes, you run `dn kickstart` again and answer the
same two prompts.

**Idea:** After a successful kickstart, prompt once: “Mark #42 done and continue
with next? (y/n).” If y: call `markDone` (and close issue), then immediately
suggest next and run kickstart again (or at least print “Run `dn kickstart` for
next”). Chaining in one place keeps the flow “do one → mark done → do next”
without re-typing.

### 3. “Add to todo” from other commands

**Plan:** “After dn prep or dn loop that creates a new plan, optionally prompt
‘Add this plan to your todo?’”

**Today:** Not implemented; only the “write initial list from 5 scored issues”
path adds to todo.

**Idea:** After `dn prep` (or `dn loop` when a plan is created/updated), prompt
“Add this plan to your todo? (y/n).” If y, `addToTodoList(planFilePath)`. Then
“run kickstart with no ticket” can suggest that plan in the same list as issues.
Streamlines: prep several → tidy or kickstart (no args) later and have plans +
issues in one ordered list.

### 4. Show the list from the CLI

**Today:** User must open `~/.dn/todo.md` to see what’s next.

**Idea:** `dn todo` or `dn todo list`: print unchecked items (and optionally
checked) with ref + title so the next “first” is obvious. Fits the “what do I do
next?” moment without leaving the terminal.

### 5. Batch “done” for the end of a session

**Today:** `dn todo done` does one item.

**Idea:** For “I just closed 3 PRs,” support marking several as done in one go,
e.g. `dn todo done --last 3` (mark first 3 unchecked as done) or
`dn todo done 42 43 44`. Reduces repeated `dn todo done` at the end of a batch.

### 6. Configurable “first” (e.g. by repo or label)

**Plan (v2):** “Store optional milestone or label in todo lines; sort by
user-defined priority then score.”

**Idea:** When the list mixes repos or milestones, let the user pin “what counts
as first” (e.g. “only current repo” or “only items with label X”) so
`dn kickstart` (no args) doesn’t suggest something in another repo unless
intended. Could be a flag (`dn kickstart --repo-only`) or a small config in
`~/.dn` (e.g. “prefer refs matching this repo”).

### 7. Document the workflow in one place

**Done:** This file. Keeping a single “recommended workflow” (tidy → kickstart
loop → todo done) and a quick-reference table makes it easy to onboard and to
refine the flow as the above improvements land.

---

## Summary

- **Implemented:** Todo list, `dn todo done`, kickstart-without-ticket (suggest
  from list or search + score), `dn tidy`, scoring with bundled prompt, merge
  with confirmation.
- **Best workflow for multiple tickets in one sitting:** Run `dn tidy`
  (optional) once, then repeatedly `dn kickstart` (no args) → y → y to do the
  next suggested ticket, and `dn todo done` (or `dn todo done &lt;ref&gt;`) when
  you’re done with a ticket so the issue is closed and the list stays in sync.
- **Improvements that would streamline further:** Fewer prompts (or
  `--yes`/`--next`), “mark done and continue?” after kickstart, “add to todo?”
  after prep/loop, `dn todo list`, and optional batch-done / repo-scoped
  “first.”
