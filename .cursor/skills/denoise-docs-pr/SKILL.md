---
name: denoise-docs-pr
description: >-
  Create pull requests in the collocated denoise-docs documentation site
  (../denoise-docs). Use when the user asks to document dn/denoise in
  denoise-docs, update Starlight pages, or open a PR at
  chesapeakedev/denoise-docs from this repository.
---

# denoise-docs pull requests

Create documentation changes in the **denoise-docs** sibling repository and open
a pull request on GitHub. This skill assumes **denoise-docs is collocated** with
this repo:

```text
parent/
├── dn/            ← this repo (cwd may be here)
└── denoise-docs/  ← documentation site target
```

Resolve the docs root as `../denoise-docs` from this repository root. If that
path is missing, stop and tell the user denoise-docs must be cloned beside `dn`.

Repository: https://github.com/chesapeakedev/denoise-docs

## Workflow

Follow these steps in order. Do not skip the pull or the return-to-`main` steps.

### 1. Enter denoise-docs and refresh `main`

```bash
cd ../denoise-docs
git checkout main
git pull
```

Run `git pull` **before** creating a feature branch so the branch starts from
the latest remote `main`.

### 2. Inspect state (parallel)

From `denoise-docs/`:

```bash
git status
git diff
git log -5 --oneline
```

### 3. Create a feature branch

```bash
git checkout -b docs/<short-topic>
```

Use a descriptive branch name (for example
`docs/dn-github-actions-deepinfra-kimi`).

### 4. Edit documentation

| What           | Where                                                            |
| -------------- | ---------------------------------------------------------------- |
| Markdown pages | `src/content/docs/**/*.md`                                       |
| Sidebar / nav  | `astro.config.mjs` (`sidebar` array)                             |
| Landing links  | `src/content/docs/introduction.md`, `src/content/docs/index.mdx` |

Conventions:

- Each page needs Starlight frontmatter: `title`, `description`.
- New pages need a matching `slug` entry in `astro.config.mjs`.
- Prefer linking to existing dn docs in this repo (`docs/`) when describing
  behavior; denoise-docs is the user-facing site.
- Do not edit `node_modules/` or commit build output (`dist/`).

Optional local preview (from `denoise-docs/`):

```bash
npm install   # humans manage dependencies; run only if needed
npm run dev
```

### 5. Commit

Only commit when the user asked for a PR (creating a PR implies committing doc
changes). Draft a message focused on **why** the docs changed.

```bash
git add <paths>
git commit -m "$(cat <<'EOF'
Short summary of the documentation change.

EOF
)"
```

### 6. Push and open the pull request

```bash
git push -u origin HEAD
```

Then create the PR with `gh` (use a HEREDOC for the body):

```bash
gh pr create --title "..." --body "$(cat <<'EOF'
## Summary
- ...

## Test plan
- [ ] ...

EOF
)"
```

Return the PR URL to the user.

### 7. Return denoise-docs to `main`

After the PR is created, check out `main` again so the local clone is not left
on the feature branch:

```bash
git checkout main
```

Do this even if the user will keep editing; they can switch back to the branch
manually.

## PR body template

```markdown
## Summary

- Bullet points describing new or updated pages

## Test plan

- [ ] Sidebar entry appears for new pages
- [ ] Internal doc links resolve
- [ ] (Optional) `npm run build` succeeds
```

## Common doc tasks

**New kickstart / dn CLI page**

1. Add `src/content/docs/<section>/<page>.md` with frontmatter.
2. Register slug under the correct group in `astro.config.mjs`.
3. Link from related pages (for example `introduction.md` quick links).

**GitHub Actions / workflow documentation**

- Canonical workflow reference: align with `docs/denoise-integration.md` and
  `docs/github-actions.md` in this (`dn`) repo.
- Installed paths: `.github/dn/config.json`, `.github/workflows/dn-*.yml`.

## Pitfalls

| Mistake                      | Fix                                                  |
| ---------------------------- | ---------------------------------------------------- |
| Branch from stale `main`     | Always `git checkout main && git pull` first         |
| Leave repo on feature branch | Always `git checkout main` after `gh pr create`      |
| Forgot sidebar entry         | New pages are unreachable without `astro.config.mjs` |
| Edit wrong repo              | Confirm cwd is `../denoise-docs`, not `dn/`          |
| Use `sl` in denoise-docs     | denoise-docs uses **git**, not Sapling               |

## Example session

```bash
cd ../denoise-docs
git checkout main
git pull
git checkout -b docs/my-topic
# ... edit src/content/docs/ and astro.config.mjs ...
git add astro.config.mjs src/content/docs/kickstart/my-topic.md
git commit -m "Add kickstart topic documentation."
git push -u origin HEAD
gh pr create --title "Add kickstart topic docs" --body "$(cat <<'EOF'
## Summary
- Add page for ...

## Test plan
- [ ] Page renders in Starlight dev server

EOF
)"
git checkout main
```
