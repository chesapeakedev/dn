// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { resolveGitHubToken } from "../sdk/github/token.ts";
import { getCurrentRepoFromRemote } from "../sdk/github/github-gql.ts";
import { createLabelWithGh } from "../sdk/github/label.ts";

const WORKFLOW_TEMPLATE = `name: Denoise Build

on:
  workflow_dispatch:
    inputs:
      issue_url:
        description: 'GitHub issue URL'
        required: true
        type: string
  issues:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  reject-untrusted:
    if: >
      github.event.label.name == 'denoise-build' &&
      !(github.event.sender.association == 'OWNER' ||
        github.event.sender.association == 'MEMBER' ||
        github.event.sender.association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    steps:
      - name: Explain maintainer-only label
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: "Thanks for the request! The \`denoise-build\` label can only be used by project maintainers because it consumes resources. A maintainer can re-apply the label if they decide to proceed."
            });

  build:
    if: >
      github.event.label.name == 'denoise-build' &&
      (github.event.sender.association == 'OWNER' ||
       github.event.sender.association == 'MEMBER' ||
       github.event.sender.association == 'COLLABORATOR')
    runs-on: ubuntu-latest
    outputs:
      issue_number: \${{ steps.issue.outputs.number }}
      issue_url: \${{ steps.issue.outputs.url }}
      success: \${{ steps.kickstart.outputs.success }}
      pr_url: \${{ steps.kickstart.outputs.pr_url }}
      output: \${{ steps.kickstart.outputs.output }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: ">=2.6.3"

      - name: Capture issue metadata
        id: issue
        run: |
          if [ "\${{ github.event_name }}" == "workflow_dispatch" ]; then
            ISSUE_URL="\${{ github.event.inputs.issue_url }}"
          else
            ISSUE_URL="\${{ github.event.issue.html_url }}"
          fi
          echo "url=\$ISSUE_URL" >> \$GITHUB_OUTPUT
          ISSUE_NUM=$(echo "\$ISSUE_URL" | grep -oP '\\d+$')
          echo "number=\$ISSUE_NUM" >> \$GITHUB_OUTPUT

      - name: Run dn kickstart (opencode AWP)
        id: kickstart
        env:
          IS_OPEN_SOURCE: "true"
          NO_COLOR: "1"
        run: |
          OUTPUT=$(dn --awp --opencode "\${{ steps.issue.outputs.url }}" 2>&1) || EXIT_CODE=$?

          PR_URL=$(echo "\$OUTPUT" | grep -oP 'PR created: \\K[^\\s]+' || true)

          echo "output<<EOF" >> \$GITHUB_OUTPUT
          echo "\$OUTPUT" >> \$GITHUB_OUTPUT
          echo "EOF" >> \$GITHUB_OUTPUT

          if [ -n "\$PR_URL" ]; then
            echo "pr_url=\$PR_URL" >> \$GITHUB_OUTPUT
            echo "success=true" >> \$GITHUB_OUTPUT
          else
            echo "success=false" >> \$GITHUB_OUTPUT
          fi

          exit \${EXIT_CODE:-0}
`;

function showHelp(): void {
  console.log("dn init-build - Setup GitHub Actions workflow for denoise\n");
  console.log("Usage:");
  console.log("  dn init-build [options]\n");
  console.log("Options:");
  console.log("  --help, -h     Show this help message");
  console.log("\nThis command:");
  console.log("  1. Creates .github/workflows/denoise-build.yaml");
  console.log("  2. Creates the 'denoise-build' GitHub label");
  console.log("\nTo trigger a build:");
  console.log("  - Add the 'denoise-build' label to any GitHub issue");
  console.log(
    "  - Or click 'Run workflow' in GitHub Actions and provide an issue URL",
  );
}

interface InitBuildConfig {
  help: boolean;
}

function parseArgs(args: string[]): InitBuildConfig {
  const config: InitBuildConfig = { help: false };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.help = true;
    }
  }

  return config;
}

async function detectRepoRoot(): Promise<string> {
  const cwd = Deno.cwd();

  try {
    await $`sl paths default`.cwd(cwd).quiet();
    return cwd;
  } catch {
    // Not sapling, try git
  }

  try {
    await $`git rev-parse --git-dir`.cwd(cwd).quiet();
    return cwd;
  } catch {
    // Not git either
  }

  throw new Error(
    "Not in a git or sapling repository. Please run from a repository with a GitHub remote.",
  );
}

async function validateGitHubAuth(): Promise<void> {
  try {
    await resolveGitHubToken();
  } catch {
    throw new Error(
      "GitHub authentication required. Run 'dn auth' first or ensure gh is logged in.",
    );
  }
}

async function validateGhInstalled(): Promise<void> {
  try {
    await $`which gh`.quiet();
  } catch {
    throw new Error(
      "GitHub CLI (gh) not found. Please install it: https://cli.github.com/",
    );
  }
}

async function createWorkflowFile(repoRoot: string): Promise<void> {
  const workflowDir = `${repoRoot}/.github/workflows`;
  const workflowPath = `${workflowDir}/denoise-build.yaml`;

  try {
    await Deno.mkdir(workflowDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  try {
    await Deno.stat(workflowPath);
    const confirmed = confirm(
      `Workflow file already exists at ${workflowPath}. Overwrite?`,
    );
    if (!confirmed) {
      console.log("Skipped workflow file creation.");
      return;
    }
  } catch {
    // File doesn't exist, will be created
  }

  await Deno.writeTextFile(workflowPath, WORKFLOW_TEMPLATE);
  console.log(`Created: ${workflowPath}`);
}

async function createWorkflowLabel(owner: string, repo: string): Promise<void> {
  try {
    await createLabelWithGh(owner, repo, "denoise-build", {
      description: "Trigger a denoise build for this issue",
    });
    console.log(`Created label: denoise-build`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("already exists")) {
      console.log(`Label 'denoise-build' already exists`);
    } else {
      throw error;
    }
  }
}

export async function handleInitBuild(args: string[]): Promise<void> {
  const config = parseArgs(args);

  if (config.help) {
    showHelp();
    return;
  }

  console.log("Setting up denoise build workflow...\n");

  const repoRoot = await detectRepoRoot();
  console.log(`Repository root: ${repoRoot}`);

  await validateGhInstalled();
  await validateGitHubAuth();

  const repo = await getCurrentRepoFromRemote();
  console.log(`Repository: ${repo.owner}/${repo.repo}`);

  console.log("");

  await createWorkflowFile(repoRoot);
  await createWorkflowLabel(repo.owner, repo.repo);

  console.log("");
  console.log("Setup complete!");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Commit and push the workflow file to your repository");
  console.log(
    "  2. To trigger a build, add the 'denoise-build' label to any GitHub issue",
  );
  console.log(
    "  3. Or go to Actions > Denoise Build > Run workflow and enter an issue URL",
  );
  console.log("");
  console.log(
    "Note: Only repository maintainers (owners, members, collaborators) can trigger builds.",
  );
}
