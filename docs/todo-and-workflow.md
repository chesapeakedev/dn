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
- **`dn kickstart` with no ticket** — Reads the list first; if it has unchecked
  items, uses the first and asks "Proceed with …?" (one prompt). Only if the
  list is empty, prompts "Search this repo?" → fetches 5 open issues +
  `plans/*.plan.md`, **scores** them (Fibonacci 1–8), writes todo, then suggests
  first. After a successful run, prompts "Mark &lt;ref&gt; done and continue
  with next?" so you can chain without re-typing `dn kickstart`.
- **`dn tidy`** — Re-fetches open issues + plans, re-scores, updates
  `~/.dn/todo.md`; if the scorer suggests merges, prompts for confirmation
  before creating/closing issues. When `EDITOR` is set, opens the list in your
  editor after refresh so you can tweak order or add/remove entries.
- **`dn prep` / `dn loop`** — After a successful run, optionally prompts "Add
  this plan to your todo? (y/n)" so the list is populated for `dn kickstart` (no
  args) without running `dn tidy` or search.
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
- When `EDITOR` is set (e.g. `EDITOR=code --wait`), opens the list in your
  editor after refresh so you can tweak order, add items, or remove entries.
- Run once at the start of the day or when you want a fresh ordering. You can
  skip this if your list is already up to date.

### 2. Run kickstart in a loop (no ticket needed)

```bash
dn kickstart
```

- When you don't pass a ticket, `dn` **reads the list first**. If it has
  unchecked items, you get a single prompt: "Proceed with &lt;ref&gt;?" → **y**,
  then the full kickstart runs. If the list is empty, you're asked "Search this
  repo?" → **y** fetches 5 issues + plans, scores, writes todo, then suggests
  first and asks "Proceed with &lt;ref&gt;?"
- After a successful kickstart, you're prompted: "Mark &lt;ref&gt; done and
  continue with next? (y/n)". Answer **y** to mark the current ref done (and
  close the GitHub issue if applicable), then automatically run the next item
  from the list (one "Proceed?" prompt, then kickstart). So you can chain
  multiple tickets without re-typing `dn kickstart`.

You can still run `dn kickstart` again manually to do the next ticket; the list
is checked first, so you often get just one "Proceed?" when the list has items.

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

In practice you can:

- Run `dn kickstart` (no args) → one "Proceed?" when the list has items →
  implement; then "Mark done and continue?" → **y** to chain to the next.
- Or alternate manually: `dn kickstart` → (review, merge) → `dn todo done` →
  `dn kickstart` → next.

### 4. Weaving into what you’re already doing

- **You already run kickstart with a ticket**
  - Keep doing: `dn kickstart 123` or `dn kickstart https://...`.
  - Optional: after a run, add that ticket (or the next one) to the list for
    later: edit `~/.dn/todo.md` or use a future “add to todo” hook from other
    commands.

- **You already run prep then loop**
  - `dn prep 123` or `dn loop --plan-file …` → after success, you're prompted
    "Add this plan to your todo? (y/n)". Say **y** to add the plan to
    `~/.dn/todo.md`.
  - So after a few preps or loops, the list has entries and `dn kickstart` (no
    args) can use the list-first flow (one "Proceed?" prompt) without running
    `dn tidy` or search.

- **You want to see what’s on the list**
  - Open `~/.dn/todo.md` in your editor, or run a future `dn todo list` if
    added.
  - First unchecked line is what `dn kickstart` (no args) will suggest next.

- **You’re in a different repo**
  - Todo is global (`~/.dn/todo.md`). If the first unchecked item is for another
    repo, use `dn kickstart --allow-cross-repo` when that item is suggested, or
    reorder/edit the file so the current repo’s items are first.

## Quick reference

| Goal                        | Command / action                                           |
| --------------------------- | ---------------------------------------------------------- |
| Refresh list from this repo | `dn tidy` (set `EDITOR` to open list after refresh)        |
| Do next ticket (suggested)  | `dn kickstart` → Proceed? → then "Mark done and continue?" |
| Do a specific ticket        | `dn kickstart 123` or `dn kickstart URL`                   |
| Mark current done + close   | `dn todo done`                                             |
| Mark specific done + close  | `dn todo done 42` or `dn todo done URL`                    |
| Edit list by hand           | Edit `~/.dn/todo.md`                                       |

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

### 5. Document the workflow in one place

**Done:** This file. Keeping a single “recommended workflow” (tidy → kickstart
loop → todo done) and a quick-reference table makes it easy to onboard and to
refine the flow as the above improvements land.

---

## Summary

- **Implemented:** Todo list, `dn todo done`, kickstart-without-ticket (list
  checked first; one "Proceed?" when list has items; "mark done and continue?"
  after a run), `dn tidy` (opens `EDITOR` on the list when set), prep/loop "Add
  this plan to your todo?", scoring with bundled prompt, merge with
  confirmation.
- **Best workflow for multiple tickets in one sitting:** Optionally run
  `dn
  tidy` (and set `EDITOR` to edit the list after refresh). Run
  `dn kickstart` (no args) → Proceed? → after success, "Mark done and continue?"
  → **y** to chain. Or add plans via prep/loop "Add to todo?" so the list is
  populated; then `dn kickstart` (no args) often needs just one "Proceed?"
  prompt.
- **Further improvements:** `dn kickstart --yes`/`--next`, `dn todo list`,
  batch-done, repo-scoped "first."
