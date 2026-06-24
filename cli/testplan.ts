// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn testplan subcommand handler
 *
 * Generates a concise test checklist and amends it into a local plan file or
 * GitHub issue body.
 */

import { assembleCombinedPrompt } from "../sdk/github/prompt.ts";
import {
  fetchIssueFromUrl,
  resolveIssueUrlInput,
  writeIssueContext,
} from "../sdk/github/issue.ts";
import type { IssueData } from "../sdk/github/issue.ts";
import {
  getCurrentRepoFromRemote,
  updateIssue,
} from "../sdk/github/github-gql.ts";
import {
  type AgentHarness,
  getRunAgent,
  resolveAgentHarnessFromFlagsAndEnv,
} from "../sdk/github/agentHarness.ts";
import {
  normalizeTestPlanSection,
  upsertTestPlanSection,
} from "../sdk/testplan/section.ts";
import { isAbsolute, join } from "@std/path";

const GITHUB_ISSUE_URL =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[?#].*)?$/i;

interface TestPlanConfig {
  source: string | null;
  workspaceRoot?: string;
  allowCrossRepo: boolean;
  dryRun: boolean;
  agentHarness: AgentHarness;
}

type TestPlanTarget =
  | { kind: "plan-file"; path: string }
  | { kind: "github-issue"; url: string; issue: IssueData };

function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null = null,
): TestPlanConfig {
  let source: string | null = null;
  let workspaceRoot: string | undefined;
  let allowCrossRepo = false;
  let dryRun = false;
  let cursorFlag = false;
  let claudeFlag = false;
  let codexFlag = false;
  let opencodeFlag = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--allow-cross-repo") {
      allowCrossRepo = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--cursor" || arg === "-c") {
      cursorFlag = true;
    } else if (arg === "--claude") {
      claudeFlag = true;
    } else if (arg === "--codex") {
      codexFlag = true;
    } else if (arg === "--opencode") {
      opencodeFlag = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown testplan option: ${arg}`);
    } else if (!source) {
      source = arg;
    } else {
      throw new Error(`Unexpected testplan argument: ${arg}`);
    }
  }

  const agentHarness = resolveAgentHarnessFromFlagsAndEnv({
    agent: globalAgent,
    cursorFlag,
    claudeFlag,
    codexFlag,
    opencodeFlag,
  });

  return {
    source,
    workspaceRoot,
    allowCrossRepo,
    dryRun,
    agentHarness,
  };
}

function showHelp(): void {
  console.log(
    "dn testplan - Add a concise test checklist to a plan or issue\n",
  );
  console.log("Usage:");
  console.log("  dn testplan [options] <plan_file_or_github_issue_url>\n");
  console.log("Argument:");
  console.log(
    "  Local plan file path or full GitHub issue URL. Issue numbers are not accepted.\n",
  );
  console.log("Options:");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log(
    "  --allow-cross-repo       Allow issue URLs from a different repository",
  );
  console.log("  --dry-run                Print the generated section only");
  console.log("  --cursor, -c             Use Cursor headless agent");
  console.log("  --claude                 Use Claude Code CLI");
  console.log("  --codex                  Use Codex CLI");
  console.log("  --opencode               Use OpenCode CLI (default)");
  console.log("  --help, -h               Show this help message\n");
  console.log("Examples:");
  console.log("  dn testplan plans/my-feature.plan.md");
  console.log("  dn testplan https://github.com/owner/repo/issues/123");
  console.log("  dn --agent codex testplan plans/my-feature.plan.md");
}

async function resolveTarget(
  source: string,
  workspaceRoot: string,
  allowCrossRepo: boolean,
): Promise<TestPlanTarget> {
  const trimmed = source.trim();
  if (GITHUB_ISSUE_URL.test(trimmed)) {
    const url = await resolveIssueUrlInput(trimmed);
    const issue = await fetchIssueFromUrl(url);
    const currentRepo = await getCurrentRepoFromRemote();
    if (
      currentRepo.owner.toLowerCase() !== issue.owner.toLowerCase() ||
      currentRepo.repo.toLowerCase() !== issue.repo.toLowerCase()
    ) {
      if (!allowCrossRepo) {
        throw new Error(
          `Issue URL points to a different repository (${issue.owner}/${issue.repo}) than the current workspace (${currentRepo.owner}/${currentRepo.repo}). Use --allow-cross-repo to enable cross-repository operations.`,
        );
      }
    }
    return { kind: "github-issue", url, issue };
  }

  if (/^#?\d+$/.test(trimmed)) {
    throw new Error(
      "Issue numbers are not accepted by dn testplan. Pass a local plan file or full GitHub issue URL.",
    );
  }

  const path = isAbsolute(trimmed) ? trimmed : join(workspaceRoot, trimmed);
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) {
      throw new Error(`Not a file: ${source}`);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Plan file not found: ${source}`);
    }
    throw error;
  }
  return { kind: "plan-file", path };
}

async function readIncludedTestPlanPrompt(
  workspaceRoot: string,
): Promise<string> {
  const filename = "system.prompt.testplan.md";
  const candidates = [
    `${new URL("../kickstart/", import.meta.url).pathname}${filename}`,
    `${workspaceRoot}/kickstart/${filename}`,
  ];

  for (const candidate of candidates) {
    try {
      return await Deno.readTextFile(candidate);
    } catch {
      // Try next location.
    }
  }

  throw new Error(`Testplan system prompt not found: ${filename}`);
}

async function createSourceContext(
  target: TestPlanTarget,
  tmpDir: string,
): Promise<{
  sourceContent: string;
  issueContextPath?: string;
  existingPlanContent?: string;
}> {
  if (target.kind === "github-issue") {
    const issueContextPath = `${tmpDir}/issue-context.md`;
    await writeIssueContext(target.issue, issueContextPath);
    return {
      sourceContent: target.issue.body ?? "",
      issueContextPath,
      existingPlanContent: undefined,
    };
  }

  const sourceContent = await Deno.readTextFile(target.path);
  return {
    sourceContent,
    issueContextPath: undefined,
    existingPlanContent: sourceContent,
  };
}

async function generateTestPlanSection(
  config: TestPlanConfig,
  target: TestPlanTarget,
  workspaceRoot: string,
  tmpDir: string,
  issueContextPath: string | undefined,
  existingPlanContent: string | undefined,
): Promise<string> {
  const outputPath = `${tmpDir}/testplan-section.md`;
  const fakeOutput = Deno.env.get("DN_TESTPLAN_FAKE_OUTPUT");
  if (fakeOutput !== undefined) {
    await Deno.writeTextFile(outputPath, fakeOutput);
    return normalizeTestPlanSection(fakeOutput);
  }

  const sourceLabel = target.kind === "github-issue" ? target.url : target.path;
  const promptContent = await readIncludedTestPlanPrompt(workspaceRoot);
  const runtimePromptPath = `${tmpDir}/system.prompt.testplan.md`;
  await Deno.writeTextFile(
    runtimePromptPath,
    `${promptContent.trimEnd()}\n\n## Output File\n\nWrite only the generated \`## Test Plan\` section to:\n\n\`${outputPath}\`\n\n## Source\n\n${sourceLabel}\n`,
  );

  const combinedPromptPath = `${tmpDir}/combined_prompt_testplan.txt`;
  await assembleCombinedPrompt(
    combinedPromptPath,
    runtimePromptPath,
    workspaceRoot,
    issueContextPath,
    undefined,
    existingPlanContent,
  );

  const runAgent = getRunAgent(config.agentHarness);
  const result = await runAgent(
    "plan",
    combinedPromptPath,
    workspaceRoot,
    true,
  );
  if (result.code !== 0) {
    console.error("\n=== Test Plan STDERR ===");
    console.error(result.stderr || "(empty)");
    console.error("\n=== Test Plan STDOUT ===");
    console.error(result.stdout || "(empty)");
    throw new Error(
      `Test plan generation failed with exit code ${result.code}`,
    );
  }

  try {
    return normalizeTestPlanSection(await Deno.readTextFile(outputPath));
  } catch (error) {
    if (result.stdout.trim() !== "") {
      return normalizeTestPlanSection(result.stdout);
    }
    throw new Error(
      `Test plan generation did not write ${outputPath}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function handleTestPlan(
  args: string[],
  globalAgent: AgentHarness | null = null,
): Promise<void> {
  let config: TestPlanConfig;
  try {
    config = parseArgs(args, globalAgent);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }

  if (!config.source) {
    console.error("Error: Plan file or GitHub issue URL required.");
    console.error("\nUse 'dn testplan --help' for usage information.");
    Deno.exit(1);
  }

  if (config.workspaceRoot) {
    try {
      Deno.chdir(config.workspaceRoot);
    } catch (error) {
      console.error(
        `Error: Cannot use workspace root: ${config.workspaceRoot}`,
      );
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }
  }

  const workspaceRoot = Deno.cwd();
  try {
    const target = await resolveTarget(
      config.source,
      workspaceRoot,
      config.allowCrossRepo,
    );
    const tmpDir = await Deno.makeTempDir({ prefix: "dn-testplan-" });
    const { sourceContent, issueContextPath, existingPlanContent } =
      await createSourceContext(target, tmpDir);
    const testPlanSection = await generateTestPlanSection(
      config,
      target,
      workspaceRoot,
      tmpDir,
      issueContextPath,
      existingPlanContent,
    );

    if (config.dryRun) {
      console.log(testPlanSection.trimEnd());
      Deno.exit(0);
    }

    const updated = upsertTestPlanSection(sourceContent, testPlanSection);
    if (target.kind === "github-issue") {
      await updateIssue(
        target.issue.owner,
        target.issue.repo,
        target.issue.number,
        {
          body: updated,
        },
      );
      console.log(`Updated GitHub issue: ${target.url}`);
    } else {
      await Deno.writeTextFile(target.path, updated);
      console.log(`Updated plan file: ${target.path}`);
    }
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
