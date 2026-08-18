---
name: denoise-docs-pr
description: >-
  Commit documentation on main in the collocated denoise-docs site
  (../denoise-docs). Use when the user asks to document dn/denoise in
  denoise-docs or update Starlight pages. Do not open a pull request unless the
  user explicitly asks.
---

# denoise-docs commits

Create documentation changes in the **denoise-docs** sibling repository and
commit them on `main`. Do not open a pull request unless the user explicitly
asks. This skill assumes **denoise-docs is collocated** with this repo:

```text
parent/
├── dn/            ← this repo (cwd may be here)
└── denoise-docs/  ← documentation site target
```

Resolve the docs root as `../denoise-docs` from this repository root. If that
path is missing, stop and tell the user denoise-docs must be cloned beside `dn`.

Repository: https://github.com/chesapeakedev/denoise-docs

## Workflow

Follow these steps in order. Do not skip the pull.

### 1. Enter denoise-docs and refresh `main`

```bash
cd ../denoise-docs
git checkout main
git pull
```

Edit on `main`. Do not create a `docs/…` feature branch.

### 2. Inspect state (parallel)

From `denoise-docs/`:

```bash
git status
git diff
git log -5 --oneline
```

Confirm the checkout is `main` before editing.

### 3. Edit documentation

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

### 4. Commit on `main`

Commit on `main` with a message focused on **why** the docs changed. Do not
push. Do not run `gh pr create`.

```bash
git add <paths>
git commit -m "$(cat <<'EOF'
Short summary of the documentation change.

EOF
)"
```

Confirm `git status` shows a clean `main` ahead of origin (an unpushed commit is
expected).

## Opt-in pull request

Only if the user explicitly asks for a PR:

1. `git checkout main && git pull`
2. `git checkout -b docs/<short-topic>`
3. Cherry-pick or re-apply the work if it already landed on local `main`
4. `git push -u origin HEAD`
5. `gh pr create` with a summary and test plan

Do not treat a docs edit as a PR request.

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

| Mistake                    | Fix                                                  |
| -------------------------- | ---------------------------------------------------- |
| Edit on stale `main`       | Always `git checkout main && git pull` first         |
| Commit while not on `main` | Confirm branch before `git commit`                   |
| Open a PR by default       | Commit on `main`; PR only if the user asks           |
| Forgot sidebar entry       | New pages are unreachable without `astro.config.mjs` |
| Edit wrong repo            | Confirm cwd is `../denoise-docs`, not `dn/`          |
| Use `sl` in denoise-docs   | denoise-docs uses **git**, not Sapling               |

## Example session

```bash
cd ../denoise-docs
git checkout main
git pull
# ... edit src/content/docs/ and astro.config.mjs on main ...
git add astro.config.mjs src/content/docs/kickstart/my-topic.md
git commit -m "Add kickstart topic documentation."
git status
```
