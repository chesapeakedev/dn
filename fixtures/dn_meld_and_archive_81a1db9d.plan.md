---
name: dn meld and archive
overview: "Add two new dn subcommands: **meld** (merge and trim markdown from multiple sources, with acceptance-criteria output for opencode/cursor) and **archive** (derive a commit message from a plan file, optionally commit with --yolo), plus recording acceptance criteria in opencode vs cursor modes."
todos: []
isProject: false
---

# dn meld and dn archive

## Context

- **dn** CLI lives in [dn/cli/](dn/cli/); subcommands are registered in
  [dn/cli/main.ts](dn/cli/main.ts) via a `switch` on `args[0]`. New handlers
  follow the pattern of [dn/cli/loop.ts](dn/cli/loop.ts) and
  [dn/cli/prep.ts](dn/cli/prep.ts) (parse args, validate, call lib, exit).
- **Plan files**: Markdown with sections like Overview, Issue Context,
  Implementation Plan, **Acceptance Criteria** (checkboxes `- [ ]` / `- [x]`).
  Completion is detected in [dn/kickstart/lib.ts](dn/kickstart/lib.ts) via
  `checkAcceptanceCriteriaCompletion()` (regex for `## Acceptance Criteria` and
  checkbox lines).
- **GitHub issue body as source**:
  [dn/sdk/github/issue.ts](dn/sdk/github/issue.ts) exposes
  `fetchIssueFromUrl(issueUrl)` returning `IssueData` with `body`; use this to
  resolve meld sources that are GitHub issue URLs.
- **Commit message today**: [dn/sdk/github/vcs.ts](dn/sdk/github/vcs.ts) uses
  `#${issueData.number} ${issueData.title}`. Archive will derive a similar
  summary from plan content and optional filename PR prefix.
- **VCS**: Repo uses Sapling (sl); archive's `--yolo` must use `sl commit` when
  in a Sapling repo (see [AGENTS.md](AGENTS.md) and Sapling skill).

---

## 1. dn meld

**Purpose:** Given multiple markdown sources (local paths and/or GitHub issue
URLs), normalize and merge them into a single, DRY markdown document with an
acceptance-criteria checklist, then optionally trim redundancy and whitespace.
Output is suitable for feeding into `dn loop` or Cursor as a plan.

**CLI surface:**

- **Positional args:** List of meld sources (local `.md` paths and/or GitHub
  issue URLs).
- `**--list` / `-l`:** Path to a file containing a newline-separated list of
  meld sources (same format as positionals).
- **Output:** Merged markdown. Default: stdout. Optional `--output <path>` (or
  `-o`) to write to a file (e.g. `plans/foo.plan.md`).
- **Mode (acceptance criteria recording):**
  - **Opencode mode (default or `--opencode`):** Emit a single markdown doc with
    a top-level **Acceptance Criteria** section containing markdown checkbox
    list (`- [ ]`). No YAML frontmatter required for task tracking.
  - **Cursor mode (`--cursor` or `-c`):** Same content but add/update **YAML
    frontmatter** with task information (e.g. `tasks:`, `acceptance_criteria:`,
    or similar) so Cursor can use it for plan/session state. Exact keys TBD
    (e.g. title, summary, tasks list); keep compatible with existing plan
    structure so `checkAcceptanceCriteriaCompletion` still works on the body
    (Acceptance Criteria section remains in body).
- **Processing steps (in order):**
  1. **Resolve sources:** For each positional or each line in `-l` file: if it
     looks like a GitHub issue URL (e.g.
     `https://github.com/owner/repo/issues/123`), call `fetchIssueFromUrl` and
     use `title` + `body` as markdown; otherwise read local file. Normalize to a
     single string per source.
  2. **Make DRY / trim:** Deduplicate identical or near-identical paragraphs or
     bullet blocks; collapse redundant headings (e.g. multiple "Overview"
     sections → one); trim trailing/leading whitespace and normalize blank lines
     (e.g. max one blank between blocks).
  3. **Merge:** Concatenate or structurally merge the normalized contents (e.g.
     merge Overviews, merge Implementation Plan sections, merge Notes). Preserve
     at most one "Acceptance Criteria" section and merge checklist items from
     all sources into one list (deduplicated by normalized text).
  4. **Acceptance criteria section:** Ensure exactly one **Acceptance Criteria**
     section. In opencode mode: markdown checkboxes only. In cursor mode: same
     checkboxes in body plus frontmatter representation (e.g. list of task
     titles or checklist items in YAML).
  5. **Final pass:** Remove redundant information again (re-run dedup/trim on
     the merged result); reduce unnecessary headings (e.g. collapse "Overview"
     and "Summary" if they duplicate).

**Implementation layout:**

- **New:** `dn/cli/meld.ts` — parse args (positionals, `-l`, `--output`,
  `--cursor`/`--opencode`), resolve sources (local + GitHub), call meld lib,
  write to file or stdout.
- **New:** `dn/sdk/meld/` (or `dn/meld/`) — pure functions:
  - `resolveSource(source: string): Promise<string>` — URL → fetch issue body (+
    title); path → read file.
  - `normalizeMarkdown(content: string): string` — trim whitespace, collapse
    blank lines.
  - `deduplicateBlocks(content: string): string` — paragraph/bullet dedup,
    heading collapse.
  - `mergeMarkdown(sources: string[]): string` — structural merge (Overviews,
    Implementation Plan, Acceptance Criteria, etc.).
  - `ensureAcceptanceCriteriaSection(content: string, mode: 'opencode' | 'cursor'): string`
    — add or merge Acceptance Criteria; in cursor mode inject/update YAML
    frontmatter with task info.
- **Reuse:** `fetchIssueFromUrl` and `IssueData` from
  [dn/sdk/github/issue.ts](dn/sdk/github/issue.ts). Use existing token/auth
  (e.g. same as kickstart).
- **main.ts:** Add `case "meld": await handleMeld(subcommandArgs); break;` and
  document in `showUsage()`.

**Edge cases:**

- Empty or missing file: skip or treat as empty string.
- Fetch failure for URL: surface error and exit non-zero.
- No acceptance criteria in any source: still emit an "Acceptance Criteria"
  section with a single placeholder checkbox (e.g. "Implement plan") so the
  output is always loop-ready.

---

## 2. dn archive

**Purpose:** Read a plan file and produce a git/sl commit message (to stdout).
Optionally perform the commit on staged files with `--yolo`. Enables moving
plans in/out of the repo while keeping a clean commit history (e.g. "183: Run
Kickstart from Our Own Hardware").

**CLI surface:**

- **Positional arg:** One path: `dn archive <file_path>.plan.md`
- **Behavior:** Read the plan markdown; derive a commit message; print to stdout
  (summary + optional body).
- **--yolo:** After printing the message, create a commit from the **current
  staged files** using that message (no automatic add of the plan file — user
  stages what they want). Use Sapling when repo is sl-backed
  (`sl commit -m "..."`), else git. After the commit succeeds, **delete the plan
  file** from the filesystem.
- **PR number prefix:** If the plan filename matches `<number>-<rest>.plan.md`
  (e.g. `183-kickstart-runners.plan.md`), use `<number>: <summary>` as the first
  line of the commit message (e.g. `183: Run Kickstart from Our Own Hardware`).
  Otherwise use only the derived summary (e.g. first H1 or Overview).

**Commit message derivation:**

- **Summary line:** If filename is `N-name.plan.md` → `N: <title>`, where
  `<title>` is the first H1 text from the plan (or first line of Overview). Else
  → first H1 or first non-empty heading/text as summary.
- **Body (optional):** Truncated Overview or first paragraph (e.g. first 200
  chars) as commit body; or leave body empty for brevity. Keep body to a few
  lines to avoid huge commits.

**Implementation layout:**

- **New:** `dn/cli/archive.ts` — parse args (single path, `--yolo`); read plan
  file; call archive lib to build message; print message; if `--yolo`, detect
  VCS (sl vs git), run commit with that message on staged files, then delete the
  plan file.
- **New:** `dn/sdk/archive/` or helpers in a single module —
  `deriveCommitMessage(planContent: string, planFilePath: string): { summary: string; body?: string }`:
  parse filename for `N-`, parse markdown for first H1 and Overview snippet.
- **VCS detection:** Reuse or mirror logic from
  [dn/sdk/github/vcs.ts](dn/sdk/github/vcs.ts) (or existing detection elsewhere)
  to decide `sl` vs `git`. Use `sl commit -m "..."` or `git commit -m "..."`; do
  not stage files, only commit already staged files.
- **main.ts:** Add `case "archive": await handleArchive(subcommandArgs); break;`
  and document in `showUsage()`.

**Edge cases:**

- Plan file missing or unreadable: exit non-zero with clear error.
- Not in a repo / no VCS: `--yolo` should fail with a clear message.
- No staged files with `--yolo`: sl/git will fail; document that user must stage
  first.
- In `--yolo`, the plan file is deleted after a successful commit; if the user
  wants the plan in the commit, they must stage it before running
  `dn archive --yolo`.

---

## 3. Recording acceptance criteria (opencode vs cursor)

This is primarily **meld output format**:

- **Opencode:** Plan is plain markdown with a single **Acceptance Criteria**
  section of checkbox list (`- [ ]`). No frontmatter. Existing
  `checkAcceptanceCriteriaCompletion()` in kickstart already parses this.
- **Cursor:** Same body content for compatibility; **plus** YAML frontmatter at
  the top of the plan with task/acceptance info (e.g. `title`, `summary`,
  `acceptance_criteria: ["item1", "item2"]` or similar). Cursor can read
  frontmatter for its plan/session UI; kickstart continues to rely on the
  `## Acceptance Criteria` section in the body so no change to `lib.ts` is
  strictly required. If Cursor’s plan format later expects frontmatter-only
  tasks, meld can be extended to support that.

No change to kickstart’s **plan phase** prompts is required for meld itself; the
plan phase already asks for "Acceptance Criteria" in markdown. Optional
follow-up: in Cursor mode, if kickstart or Cursor rules ever consume
frontmatter, document the schema (e.g. in
[dn/kickstart/system.prompt.plan.md](dn/kickstart/system.prompt.plan.md) or a
small spec).

---

## 4. File and dependency summary

| Area                               | New/Modified                                               |
| ---------------------------------- | ---------------------------------------------------------- |
| [dn/cli/main.ts](dn/cli/main.ts)   | Add `meld`, `archive` to switch and usage                  |
| dn/cli/meld.ts                     | New: CLI for meld                                          |
| dn/cli/archive.ts                  | New: CLI for archive                                       |
| dn/sdk/meld/ (or dn/meld/)         | New: resolve, normalize, dedup, merge, acceptance-criteria |
| dn/sdk/archive/ (or single module) | New: deriveCommitMessage, VCS-aware commit                 |
| dn/sdk/github/issue.ts             | Reuse fetchIssueFromUrl (no change)                        |
| dn/sdk/github/vcs.ts               | Reuse or expose VCS detection for archive --yolo           |

---

## 5. Acceptance criteria (for this plan)

- **meld positional:** `dn meld a.md b.md https://github.com/o/r/issues/1`
  merges and outputs merged markdown (stdout or `-o`).
- **meld -l:** `dn meld -l sources.txt` reads newline-separated sources from
  file and merges.
- **meld DRY/trim:** Merged output has trimmed whitespace, collapsed redundant
  headings, and deduplicated blocks where possible.
- **meld Acceptance Criteria:** Output includes exactly one Acceptance Criteria
  section with checkbox list; in cursor mode, YAML frontmatter includes
  task/acceptance info.
- **meld GitHub URL:** GitHub issue URLs are fetched and issue body (+ title)
  used as markdown source.
- **archive stdout:** `dn archive path/to/plan.plan.md` prints a commit message
  (summary + optional body) to stdout.
- **archive PR prefix:** For filename `183-name.plan.md`, summary line starts
  with `183:` .
- **archive --yolo:** With `--yolo`, commit current staged files with the
  derived message using sl or git, then delete the plan file.
- **Docs:** Usage for `dn meld` and `dn archive` appears in `dn --help` /
  subcommand `--help`.

---

## 6. Out of scope (for this plan)

- **Moving plan files “outside the repo”:** No new `dn archive --move` or copy
  to `~/.dn/plans` in this pass; user can copy the plan file manually. Meld +
  archive together give a clean commit message and optional commit; moving can
  be a later flag.
- **Cursor plan schema:** Defining a formal YAML schema for Cursor frontmatter
  can be a small follow-up; meld only needs a minimal, stable set of keys (e.g.
  title, acceptance_criteria list).
- **Denoise app:** No changes to denoise/; only dn CLI and dn SDK.
