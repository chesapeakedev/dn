// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { $ } from "$dax";
import { resolveGitHubToken } from "../sdk/github/token.ts";
import { getCurrentRepoFromRemote } from "../sdk/github/github-gql.ts";
import { createLabelWithGh } from "../sdk/github/label.ts";
import {
  getRepoAgent,
  loadConfig,
  saveConfig,
  setRepoAgent,
} from "../sdk/auth/config.ts";
import {
  AGENT_HARNESSES,
  type AgentHarness,
} from "../sdk/github/agentHarness.ts";

interface AgentConfig {
  secret: string;
  keyUrl: string;
  keyName: string;
  isClaude: boolean;
}

const AGENT_CONFIGS: Record<AgentHarness, AgentConfig> = {
  opencode: {
    secret: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    keyName: "OPENAI_API_KEY",
    isClaude: false,
  },
  cursor: {
    secret: "CURSOR_API_KEY",
    keyUrl: "https://cursor.com/docs/cli",
    keyName: "CURSOR_API_KEY",
    isClaude: false,
  },
  claude: {
    secret: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyName: "ANTHROPIC_API_KEY",
    isClaude: true,
  },
  codex: {
    secret: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    keyName: "OPENAI_API_KEY",
    isClaude: false,
  },
};

function generateWorkflow(agent: AgentHarness): string {
  const config = AGENT_CONFIGS[agent];
  const isClaude = config.isClaude;
  const secret = config.secret;

  const lines: string[] = [];

  lines.push("name: Denoise Build");
  lines.push("");
  lines.push("on:");
  lines.push("  workflow_dispatch:");
  lines.push("    inputs:");
  lines.push("      issue_url:");
  lines.push("        description: 'GitHub issue URL'");
  lines.push("        required: true");
  lines.push("        type: string");
  lines.push("  issues:");
  lines.push("    types: [labeled]");
  lines.push("");
  lines.push("permissions:");
  lines.push("  contents: write");
  lines.push("  pull-requests: write");
  lines.push("  issues: write");
  lines.push("");
  lines.push("jobs:");
  lines.push("  reject-untrusted:");
  lines.push("    if: >");
  lines.push("      github.event.label.name == 'denoise-build' &&");
  lines.push("      !(github.event.sender.association == 'OWNER' ||");
  lines.push("        github.event.sender.association == 'MEMBER' ||");
  lines.push("        github.event.sender.association == 'COLLABORATOR')");
  lines.push("    runs-on: ubuntu-latest");
  lines.push("    steps:");
  lines.push("      - name: Install dn");
  lines.push("        uses: chesapeakedev/dn-action@v1");
  lines.push("");
  lines.push("      - name: Explain maintainer-only label");
  lines.push("        run: |");
  lines.push("          cat > /tmp/comment.md << 'EOF'");
  lines.push(
    "          Thanks for the request! The `denoise-build` label can only be used by project maintainers because it consumes resources. A maintainer can re-apply the label if they decide to proceed.",
  );
  lines.push("          EOF");
  lines.push(
    "          dn issue comment ${{ github.event.issue.number }} --body-file /tmp/comment.md",
  );
  lines.push("        env:");
  lines.push("          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  lines.push("");
  lines.push("  build:");
  lines.push("    if: >");
  lines.push("      github.event.label.name == 'denoise-build' &&");
  lines.push("      (github.event.sender.association == 'OWNER' ||");
  lines.push("       github.event.sender.association == 'MEMBER' ||");
  lines.push("       github.event.sender.association == 'COLLABORATOR')");
  lines.push("    runs-on: ubuntu-latest");
  lines.push("    outputs:");
  lines.push("      issue_number: ${{ steps.issue.outputs.number }}");
  lines.push("      issue_url: ${{ steps.issue.outputs.url }}");
  lines.push("      success: ${{ steps.kickstart.outputs.success }}");
  lines.push("      pr_url: ${{ steps.kickstart.outputs.pr_url }}");
  lines.push("      output: ${{ steps.kickstart.outputs.output }}");
  lines.push("    steps:");
  lines.push("      - name: Checkout repository");
  lines.push("        uses: actions/checkout@v4");
  lines.push("        with:");
  lines.push("          fetch-depth: 0");
  lines.push("");
  lines.push("      - name: Set up Deno");
  lines.push("        uses: denoland/setup-deno@v1");
  lines.push("        with:");
  lines.push('          deno-version: ">=2.6.3"');
  lines.push("");
  lines.push("      - name: Install dn");
  lines.push("        uses: chesapeakedev/dn-action@v1");
  lines.push("");
  lines.push("      - name: Capture issue metadata");
  lines.push("        id: issue");
  lines.push("        run: |");
  lines.push(
    '          if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
  );
  lines.push('            ISSUE_URL="${{ github.event.inputs.issue_url }}"');
  lines.push("          else");
  lines.push('            ISSUE_URL="${{ github.event.issue.html_url }}"');
  lines.push("          fi");
  lines.push('          echo "url=$ISSUE_URL" >> $GITHUB_OUTPUT');
  lines.push("          ISSUE_NUM=$(echo \"$ISSUE_URL\" | grep -oP '\\d+$')");
  lines.push('          echo "number=$ISSUE_NUM" >> $GITHUB_OUTPUT');
  lines.push("");
  lines.push(`      - name: Run dn kickstart (${agent} AWP)`);
  lines.push("        id: kickstart");
  lines.push("        env:");
  lines.push('          IS_OPEN_SOURCE: "true"');
  lines.push('          NO_COLOR: "1"');
  lines.push("          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  const secretLine = "          " + secret + ": ${{ secrets." + secret + " }}";
  lines.push(secretLine);
  if (isClaude) {
    lines.push('          CLAUDE_CODE_BARE: "1"');
  }
  lines.push("        run: |");
  lines.push('          INPUT_URL="${{ steps.issue.outputs.url }}"');
  lines.push(
    `          OUTPUT=$(dn --agent ${agent} kickstart --awp "$INPUT_URL" 2>&1) || EXIT_CODE=$?`,
  );
  lines.push("");
  lines.push(
    "          PR_URL=$(echo \"$OUTPUT\" | grep -oP 'PR created: \\K[^\\s]+' || true)",
  );
  lines.push("");
  lines.push('          echo "output<<EOF" >> $GITHUB_OUTPUT');
  lines.push('          echo "$OUTPUT" >> $GITHUB_OUTPUT');
  lines.push('          echo "EOF" >> $GITHUB_OUTPUT');
  lines.push("");
  lines.push('          if [ -n "$PR_URL" ]; then');
  lines.push('            echo "pr_url=$PR_URL" >> $GITHUB_OUTPUT');
  lines.push('            echo "success=true" >> $GITHUB_OUTPUT');
  lines.push("          else");
  lines.push('            echo "success=false" >> $GITHUB_OUTPUT');
  lines.push("          fi");
  lines.push("");
  lines.push("          exit ${EXIT_CODE:-0}");
  lines.push("");
  lines.push("  comment:");
  lines.push("    needs: build");
  lines.push("    if: always() && needs.build.result != 'skipped'");
  lines.push("    runs-on: ubuntu-latest");
  lines.push("    steps:");
  lines.push("      - name: Install dn");
  lines.push("        uses: chesapeakedev/dn-action@v1");
  lines.push("");
  lines.push("      - name: Post kickstart results");
  lines.push("        run: |");
  lines.push('          SUCCESS="${{ needs.build.outputs.success }}"');
  lines.push('          PR_URL="${{ needs.build.outputs.pr_url }}"');
  lines.push('          OUTPUT="${{ needs.build.outputs.output }}"');
  lines.push("");
  lines.push(
    '          if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then',
  );
  lines.push('            LABELER="${{ github.actor }}"');
  lines.push('            TRIGGER="workflow dispatch"');
  lines.push("          else");
  lines.push('            LABELER="${{ github.event.sender.login }}"');
  lines.push('            TRIGGER="`denoise-build` label"');
  lines.push("          fi");
  lines.push("");
  lines.push('          if [ "$SUCCESS" = "true" ]; then');
  lines.push('            STATUS="✅ Success"');
  lines.push("          else");
  lines.push('            STATUS="❌ Failed"');
  lines.push("          fi");
  lines.push("");
  lines.push("          {");
  lines.push('            echo "## Denoise Build"');
  lines.push('            echo ""');
  lines.push('            echo "**Triggered by:** @$LABELER via $TRIGGER"');
  lines.push('            echo "**Status:** $STATUS"');
  lines.push('            echo ""');
  lines.push('            if [ -n "$PR_URL" ]; then');
  lines.push('              echo "**PR:** $PR_URL"');
  lines.push('              echo ""');
  lines.push("            fi");
  lines.push('            echo "<details>"');
  lines.push('            echo "<summary>Output</summary>"');
  lines.push('            echo ""');
  lines.push("            echo '```'");
  lines.push('            echo "$OUTPUT"');
  lines.push("            echo '```'");
  lines.push('            echo "</details>"');
  lines.push("          } > /tmp/comment.md");
  lines.push("");
  lines.push(
    "          dn issue comment ${{ needs.build.outputs.issue_number }} --body-file /tmp/comment.md",
  );
  lines.push("        env:");
  lines.push("          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");

  return lines.join("\n");
}

function showHelp(): void {
  console.log("dn init-build - Setup GitHub Actions workflow for denoise\n");
  console.log("Usage:");
  console.log("  dn init-build [options]\n");
  console.log("Options:");
  console.log("  --help, -h         Show this help message");
  console.log(
    "  --agent <agent>    Agent to use (opencode, cursor, claude, codex)",
  );
  console.log(
    "  --reset            Clear stored agent preference for this repo",
  );
  console.log("\nExamples:");
  console.log("  dn init-build");
  console.log("  dn init-build --agent cursor");
  console.log("  dn init-build --reset\n");
  console.log("To trigger a build:");
  console.log("  - Add the 'denoise-build' label to any GitHub issue");
  console.log(
    "  - Or click 'Run workflow' in GitHub Actions and provide an issue URL",
  );
}

interface InitBuildConfig {
  help: boolean;
  agent: AgentHarness | null;
  reset: boolean;
}

const VALID_AGENTS: readonly AgentHarness[] = AGENT_HARNESSES;

function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null = null,
): InitBuildConfig {
  const config: InitBuildConfig = {
    help: false,
    agent: globalAgent,
    reset: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
    } else if (arg === "--reset") {
      config.reset = true;
    } else if (arg === "--agent" && i + 1 < args.length) {
      const value = args[++i];
      if (!VALID_AGENTS.includes(value as AgentHarness)) {
        throw new Error(
          `Invalid agent: ${value}. Must be one of: ${VALID_AGENTS.join(", ")}`,
        );
      }
      if (config.agent && config.agent !== value) {
        throw new Error(
          `Conflicting agent selections: --agent ${config.agent} and --agent ${value}. Select only one agent.`,
        );
      }
      config.agent = value as AgentHarness;
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

function promptAgent(): AgentHarness {
  console.log("Select agent to use in GitHub Actions:");
  console.log("  1) opencode (default)");
  console.log("  2) cursor");
  console.log("  3) claude");
  console.log("  4) codex");
  console.log("");

  const input = prompt("Enter choice (1-4, or press Enter for opencode):")
    ?.trim();

  if (!input || input === "1") {
    return "opencode";
  }
  if (input === "2") {
    return "cursor";
  }
  if (input === "3") {
    return "claude";
  }
  if (input === "4") {
    return "codex";
  }

  throw new Error(`Invalid choice: ${input}. Please enter 1, 2, 3, or 4.`);
}

function isTty(): boolean {
  try {
    return Deno.stderr.isTerminal();
  } catch {
    return false;
  }
}

function printSecretsInstructions(agent: AgentHarness): void {
  const config = AGENT_CONFIGS[agent];

  console.log("");
  console.log(
    "================================================================================",
  );
  console.log("REQUIRED SETUP: Add API keys as GitHub repository secrets");
  console.log(
    "================================================================================",
  );
  console.log("");
  console.log(`Your workflow is configured to use: ${agent}`);
  console.log("");
  console.log("Run these commands to add required secrets:");
  console.log("");
  const keyType = config.keyName.toLowerCase().replace("_", "");
  console.log(`  gh secret set ${config.secret} --body "your-${keyType}-key"`);
  console.log("");
  console.log(`Where to get ${config.keyName}: ${config.keyUrl}`);
  console.log("");
  console.log(
    "Also verify: Settings → Actions → General → Workflow permissions",
  );
  console.log('  → "Allow GitHub Actions to create and approve pull requests"');
  console.log("");
  console.log(
    "================================================================================",
  );
}

async function createWorkflowFile(
  repoRoot: string,
  agent: AgentHarness,
): Promise<void> {
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

  const workflow = generateWorkflow(agent);
  await Deno.writeTextFile(workflowPath, workflow);
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

export async function handleInitBuild(
  args: string[],
  globalAgent: AgentHarness | null = null,
): Promise<void> {
  const config = parseArgs(args, globalAgent);

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

  // Handle reset flag
  if (config.reset) {
    const stored = await getRepoAgent(repo.owner, repo.repo);
    if (stored) {
      console.log(`Clearing stored agent preference: ${stored}`);
      const cfg = await loadConfig();
      delete cfg.repos[`${repo.owner}/${repo.repo}`];
      await saveConfig(cfg);
      console.log("Preference cleared.");
    } else {
      console.log("No stored agent preference to clear.");
    }
    return;
  }

  // Resolve agent: flag > stored > prompt
  let agent: AgentHarness;

  if (config.agent) {
    agent = config.agent;
  } else {
    const stored = await getRepoAgent(repo.owner, repo.repo);
    if (stored) {
      agent = stored;
    } else {
      const tty = isTty();
      if (tty) {
        agent = promptAgent();
      } else {
        throw new Error(
          "No agent specified and not in interactive mode. Use --agent flag or run in TTY.",
        );
      }
    }
  }

  // Save preference
  await setRepoAgent(repo.owner, repo.repo, agent);
  console.log(`Using agent: ${agent}`);

  console.log("");

  await createWorkflowFile(repoRoot, agent);
  await createWorkflowLabel(repo.owner, repo.repo);

  printSecretsInstructions(agent);

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
