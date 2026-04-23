# GitHub Integration

## GitHub Actions

`dn` runs in CI as a single static binary with minimal setup. The example below
triggers on issue labels, runs `dn kickstart` with Cursor, and posts results as
a comment. It demonstrates proper permissions, API key handling, and output
capture.

**Implementation Considerations:**

- Provide `GITHUB_TOKEN` via secrets; `dn auth` is not suitable for CI.
- Set agent API keys as repository secrets (e.g., `OPENAI_API_KEY`).
- Require `contents: write` for branches/commits and `pull-requests: write` for
  opening PRs.
- Capture `dn` output to extract PR URLs and post feedback to the triggering
  issue.

```yaml
name: Kickstart with dn

on:
  issues:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  kickstart:
    if: github.event.label.name == 'cursor awp'
    runs-on: ubuntu-latest
    outputs:
      pr_url: ${{ steps.kickstart.outputs.pr_url }}
      success: ${{ steps.kickstart.outputs.success }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: ">=2.6.3"

      - name: Install dn
        uses: chesapeakedev/dn-action@v1

      - name: Run dn kickstart
        id: kickstart
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          IS_OPEN_SOURCE: "true"
          NO_COLOR: "1"
        run: |
          OUTPUT=$(dn --agent cursor kickstart --awp "${{ github.event.issue.html_url }}" 2>&1) || EXIT_CODE=$?

          PR_URL=$(echo "$OUTPUT" | grep -oP 'PR created: \K[^\s]+' || true)

          if [ -n "$PR_URL" ]; then
            echo "pr_url=$PR_URL" >> $GITHUB_OUTPUT
            echo "success=true" >> $GITHUB_OUTPUT
          else
            echo "success=false" >> $GITHUB_OUTPUT
          fi

          exit ${EXIT_CODE:-0}

      - name: Comment results on issue
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const prUrl = '${{ steps.kickstart.outputs.pr_url }}';
            const success = '${{ steps.kickstart.outputs.success }}' === 'true';

            const body = success
              ? `Kickstart completed! PR created: ${prUrl}`
              : `Kickstart failed. Check the workflow logs for details.`;

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body
            });
```
