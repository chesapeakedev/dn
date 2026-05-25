# GitHub issue body refresh (staging file only)

Rebuild the GitHub issue **body markdown** informed by merged research. Preserve
intent sections that still apply, drop stale boilerplate. **Summaries only** —
do not replay whole chat logs.

## Output contract

Write the finalized issue body (GitHub flavored markdown/plain text acceptable)
**only** to the staging markdown path injected below
(`plans/.meld-staging*.md`). `dn` will upload its contents verbatim.

---

The issue context will be provided below.
