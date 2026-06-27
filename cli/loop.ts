// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn loop subcommand handler
 *
 * Runs only the loop phase (Steps 4-7: implement, completion, lint, artifacts, validate)
 */

import type { KickstartConfig, LoopPhaseResult } from "../kickstart/lib.ts";
import { runLoopPhase } from "../kickstart/lib.ts";
import { getCurrentRepoFromRemote } from "../sdk/github/github-gql.ts";
import {
  fetchIssueFromUrl,
  resolveIssueUrlInput,
  writeIssueContext,
} from "../sdk/github/issue.ts";
import type { IssueData } from "../sdk/github/issue.ts";
import { promptAndAddToTodoList } from "../sdk/todo/todo.ts";
import { resolveAgentHarnessFromFlagsAndEnv } from "../sdk/github/agentHarness.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import {
  extractSandboxFlag,
  resolveSandboxFlagValue,
} from "../sdk/sandbox/cli.ts";
import { resolveSandboxConfig } from "../sdk/sandbox/resolve.ts";
import { runWithSandboxLifecycle } from "../sdk/sandbox/lifecycle.ts";
import { isAbsolute, join } from "@std/path";

const ISSUE_NUMBER_PATTERN = /^#?\d+$/;
const GITHUB_ISSUE_URL_PATTERN =
  /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)(?:[?#].*)?$/i;

interface GitHubIssueRef {
  owner: string;
  repo: string;
  number: string;
  url: string;
}

export type LoopTarget =
  | { kind: "auto" }
  | { kind: "plan-file"; path: string }
  | { kind: "github-issue"; input: string };

interface LoopCliConfig extends KickstartConfig {
  target: LoopTarget;
  planFilePath: string | null;
}

/**
 * Discovers the most recently modified plan file in the plans/ directory.
 * Returns the path if exactly one exists, prompts if multiple, or null if none.
 */
async function discoverLatestPlanFile(
  workspaceRoot: string,
): Promise<string | null> {
  const plansDir = `${workspaceRoot}/plans`;
  try {
    const entries = await Deno.readDir(plansDir);
    const planFiles: { name: string; mtime: Date }[] = [];
    for await (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".plan.md")) {
        const stat = await Deno.stat(`${plansDir}/${entry.name}`);
        if (stat.mtime) {
          planFiles.push({ name: entry.name, mtime: stat.mtime });
        }
      }
    }

    if (planFiles.length === 0) {
      return null;
    }

    if (planFiles.length === 1) {
      return `${plansDir}/${planFiles[0].name}`;
    }

    // Multiple plan files - pick the most recently modified
    planFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const latest = planFiles[0];
    console.log(
      `Found ${planFiles.length} plan files, using most recent: ${latest.name}`,
    );
    return `${plansDir}/${latest.name}`;
  } catch {
    return null;
  }
}

function parseGitHubIssueUrl(url: string): GitHubIssueRef | null {
  const match = url.match(GITHUB_ISSUE_URL_PATTERN);
  if (!match) {
    return null;
  }
  const [, owner, repo, number] = match;
  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/issues/${number}`,
  };
}

export function classifyLoopTarget(input: string | null): LoopTarget {
  if (!input) {
    return { kind: "auto" };
  }
  const trimmed = input.trim();
  if (
    GITHUB_ISSUE_URL_PATTERN.test(trimmed) || ISSUE_NUMBER_PATTERN.test(trimmed)
  ) {
    return { kind: "github-issue", input: trimmed };
  }
  return { kind: "plan-file", path: trimmed };
}

async function planFileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

async function resolvePlanFilePathInput(
  path: string,
  workspaceRoot: string,
): Promise<string> {
  if (isAbsolute(path)) {
    return path;
  }
  if (await planFileExists(path)) {
    return path;
  }
  return join(workspaceRoot, path);
}

async function listPlanFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        files.push(...await listPlanFiles(path));
      } else if (entry.isFile && entry.name.endsWith(".plan.md")) {
        files.push(path);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
  return files;
}

function planContentMatchesIssue(
  content: string,
  issue: GitHubIssueRef,
  allowShortIssueNumber: boolean,
): boolean {
  const escapedOwner = issue.owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedRepo = issue.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fullUrlPattern = new RegExp(
    `https?://github\\.com/${escapedOwner}/${escapedRepo}/issues/${issue.number}(?:[?#][^\\s)]*)?`,
    "i",
  );
  if (fullUrlPattern.test(content)) {
    return true;
  }
  if (content.includes(`${issue.owner}/${issue.repo}#${issue.number}`)) {
    return true;
  }
  if (!allowShortIssueNumber) {
    return false;
  }
  return new RegExp(`(^|[\\s([:])#${issue.number}(\\b|[\\])])`).test(content);
}

async function findPlanFileForIssue(
  workspaceRoot: string,
  issue: GitHubIssueRef,
  allowShortIssueNumber: boolean,
): Promise<string | null> {
  const planFiles = await listPlanFiles(join(workspaceRoot, "plans"));
  const matches: { path: string; mtime: number }[] = [];
  for (const path of planFiles) {
    const content = await Deno.readTextFile(path);
    if (!planContentMatchesIssue(content, issue, allowShortIssueNumber)) {
      continue;
    }
    const stat = await Deno.stat(path);
    matches.push({ path, mtime: stat.mtime?.getTime() ?? 0 });
  }
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  if (matches.length > 1) {
    console.log(
      `Found ${matches.length} matching plan files, using most recent: ${
        matches[0].path.replace(workspaceRoot + "/", "")
      }`,
    );
  }
  return matches[0].path;
}

export async function resolveLoopTarget(
  target: LoopTarget,
  workspaceRoot: string,
): Promise<{
  planFilePath: string | null;
  issueUrl: string | null;
  planSource: "file" | "github-issue";
}> {
  if (target.kind === "auto") {
    const discovered = await discoverLatestPlanFile(workspaceRoot);
    if (!discovered) {
      throw new Error(
        "No plan files found in plans/. Run 'dn prep <issue>' first or pass a plan file, issue URL, or issue number.",
      );
    }
    return { planFilePath: discovered, issueUrl: null, planSource: "file" };
  }

  if (target.kind === "plan-file") {
    return {
      planFilePath: await resolvePlanFilePathInput(target.path, workspaceRoot),
      issueUrl: null,
      planSource: "file",
    };
  }

  const issueUrl = await resolveIssueUrlInput(target.input);
  const issue = parseGitHubIssueUrl(issueUrl);
  if (!issue) {
    throw new Error(`Invalid issue URL or number: ${target.input}`);
  }
  const allowShortIssueNumber = ISSUE_NUMBER_PATTERN.test(target.input);
  const planFilePath = await findPlanFileForIssue(
    workspaceRoot,
    issue,
    allowShortIssueNumber,
  );
  if (!planFilePath) {
    return { planFilePath: null, issueUrl, planSource: "github-issue" };
  }
  return { planFilePath, issueUrl, planSource: "file" };
}

/**
 * Parses loop-specific arguments
 */
function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): LoopCliConfig {
  let planFilePath: string | null = null;
  let targetInput: string | null = null;
  let cursorFlag = false;
  let claudeFlag = false;
  let codexFlag = false;
  let copilotFlag = false;
  let opencodeFlag = false;
  let workspaceRoot: string | undefined = undefined;
  let allowCrossRepo = false;

  const { sandbox: localSandbox, rest: flagArgs } = extractSandboxFlag(args);
  const sandboxFlag = resolveSandboxFlagValue(globalSandbox, localSandbox);

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--plan-file" && i + 1 < args.length) {
      planFilePath = args[++i];
    } else if (arg === "--allow-cross-repo") {
      allowCrossRepo = true;
    } else if (arg === "--cursor" || arg === "-c") {
      cursorFlag = true;
    } else if (arg === "--claude") {
      claudeFlag = true;
    } else if (arg === "--codex") {
      codexFlag = true;
    } else if (arg === "--copilot") {
      copilotFlag = true;
    } else if (arg === "--opencode") {
      opencodeFlag = true;
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown loop option: ${arg}`);
    } else if (!targetInput) {
      targetInput = arg;
    } else {
      throw new Error(`Unexpected loop argument: ${arg}`);
    }
  }

  // Fallback to environment variables
  if (!planFilePath && !targetInput) {
    planFilePath = Deno.env.get("PLAN") || null;
  }

  const target = classifyLoopTarget(planFilePath ?? targetInput);

  const agentHarness = resolveAgentHarnessFromFlagsAndEnv({
    agent: globalAgent,
    cursorFlag,
    claudeFlag,
    codexFlag,
    copilotFlag,
    opencodeFlag,
  });

  return {
    publish: "none" as const,
    agentHarness,
    allowCrossRepo,
    issueUrl: null,
    saveCtx: false,
    savedPlanName: null,
    workspaceRoot,
    planFilePath,
    target,
    sandboxFlag,
  };
}

/**
 * Shows help for loop subcommand
 */
function showHelp(): void {
  console.log("dn loop - Run loop phase only\n");
  console.log("Usage:");
  console.log("  dn loop [options] [<plan_file_or_issue>]\n");
  console.log(
    "Argument: plan file path, GitHub issue URL, or issue number for current repo.",
  );
  console.log(
    "When an issue is provided, dn searches plans/ for an existing matching plan, then falls back to using the issue body directly.\n",
  );
  console.log("Options:");
  console.log(
    "  --plan-file <path>       Deprecated alias for passing a plan file argument",
  );
  console.log(
    "  --allow-cross-repo       Allow issue URLs from a different repository",
  );
  console.log("  --cursor, -c             Use Cursor headless agent");
  console.log("  --claude                 Use Claude Code CLI");
  console.log("  --codex                  Use Codex CLI");
  console.log(
    "  --copilot                Use GitHub Copilot CLI (`copilot -p`)",
  );
  console.log("  --opencode               Use OpenCode CLI (default)");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log("  --help, -h               Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT           Workspace root directory");
  console.log(
    "  PLAN                     Plan file path, issue URL, or issue number",
  );
  console.log(
    "  CURSOR_ENABLED           Set to '1' to use Cursor agent",
  );
  console.log(
    "  CLAUDE_ENABLED           Set to '1' to use Claude Code (not with CURSOR_ENABLED)\n",
  );
  console.log("  CODEX_ENABLED            Set to '1' to use Codex CLI\n");
  console.log("Examples:");
  console.log("  dn loop plans/my-feature.plan.md");
  console.log("  dn loop https://github.com/owner/repo/issues/123");
  console.log("  dn loop 123");
  console.log(
    "  dn loop --allow-cross-repo https://github.com/owner/repo/issues/123",
  );
  console.log(
    "  dn loop  # auto-discovers latest plan when no target is provided",
  );
  console.log("");
  console.log(
    "If the plan text includes a github.com issue URL, the loop phase refetches",
  );
  console.log(
    "that issue so the combined implement prompt carries `## Relationships` data.",
  );
}

/**
 * Reads plan file to extract issue context if available
 */
async function extractIssueContextFromPlan(
  planFilePath: string,
  explicitIssueUrl: string | null,
): Promise<{ issueData: IssueData | null }> {
  if (explicitIssueUrl) {
    try {
      return { issueData: await fetchIssueFromUrl(explicitIssueUrl) };
    } catch {
      // If fetch fails, continue without issue data.
    }
  }

  try {
    const planContent = await Deno.readTextFile(planFilePath);

    // Try to extract issue URL from plan content
    const issueUrlMatch = planContent.match(
      /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/,
    );
    if (issueUrlMatch) {
      const [, owner, repo, number] = issueUrlMatch;
      const issueUrl = `https://github.com/${owner}/${repo}/issues/${number}`;
      try {
        const issueData = await fetchIssueFromUrl(issueUrl);
        return { issueData };
      } catch {
        // If fetch fails, continue without issue data
      }
    }
  } catch {
    // If reading plan fails, continue without issue data
  }

  return { issueData: null };
}

async function materializeIssuePlanFile(
  issueUrl: string,
  tmpDir: string,
): Promise<{ planFilePath: string; issueData: IssueData }> {
  const issueData = await fetchIssueFromUrl(issueUrl);
  const planFilePath =
    `${tmpDir}/issue-${issueData.owner}-${issueData.repo}-${issueData.number}.md`;
  await writeIssueContext(issueData, planFilePath);
  return { planFilePath, issueData };
}

/**
 * Handles the loop subcommand
 */
export async function handleLoop(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): Promise<void> {
  let config: LoopCliConfig;
  try {
    config = parseArgs(args, globalAgent, globalSandbox);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }

  const root = config.workspaceRoot || Deno.env.get("WORKSPACE_ROOT") ||
    Deno.cwd();
  let explicitIssueUrl: string | null = null;
  let planSource: "file" | "github-issue" = "file";
  try {
    const resolved = await resolveLoopTarget(config.target, root);
    config.planFilePath = resolved.planFilePath;
    explicitIssueUrl = resolved.issueUrl;
    planSource = resolved.planSource;
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("\nUse 'dn loop --help' for usage information.");
    Deno.exit(1);
  }

  try {
    const repoRoot = config.workspaceRoot ?? Deno.cwd();
    const { provider, config: sandboxConfig } = await resolveSandboxConfig(
      repoRoot,
      config.sandboxFlag,
    );
    await runWithSandboxLifecycle(
      { repoRoot, config: sandboxConfig, provider },
      async () => {
        // Create a temp directory for this run
        // FIXME: replace geo-opencode with dn-{mode id}
        const tmpDir = await Deno.makeTempDir({ prefix: "geo-opencode-" });
        const planOutputPath = `${tmpDir}/plan_output.txt`;

        let issueData: IssueData | null;
        let effectivePlanFilePath: string;
        if (config.planFilePath) {
          try {
            await Deno.stat(config.planFilePath);
          } catch {
            console.error(`Error: Plan file not found: ${config.planFilePath}`);
            Deno.exit(1);
          }
          effectivePlanFilePath = config.planFilePath;
          ({ issueData } = await extractIssueContextFromPlan(
            effectivePlanFilePath,
            explicitIssueUrl,
          ));
        } else {
          if (!explicitIssueUrl || planSource !== "github-issue") {
            throw new Error("Internal error: no plan file or GitHub issue URL");
          }
          const materialized = await materializeIssuePlanFile(
            explicitIssueUrl,
            tmpDir,
          );
          config.planFilePath = materialized.planFilePath;
          effectivePlanFilePath = materialized.planFilePath;
          issueData = materialized.issueData;
          console.log(
            `No matching local plan found; using GitHub issue ${explicitIssueUrl} directly for this loop run.`,
          );
        }

        // Read plan file content to use as plan output
        const planContent = await Deno.readTextFile(effectivePlanFilePath);
        await Deno.writeTextFile(planOutputPath, planContent);

        const result: LoopPhaseResult = await runLoopPhase(
          config,
          effectivePlanFilePath,
          planOutputPath,
          issueData,
          tmpDir,
        );

        if (result.continuationPromptPath) {
          console.log(
            `\nContinuation prompt: ${result.continuationPromptPath}`,
          );
        }

        const { completionStatus } = result;
        if (completionStatus.total > 0 && !completionStatus.complete) {
          let title: string | undefined;
          try {
            const planContent = await Deno.readTextFile(effectivePlanFilePath);
            const titleMatch = planContent.match(/^#\s+(.+)$/m);
            title = titleMatch ? titleMatch[1].trim() : undefined;
          } catch {
            title = undefined;
          }
          const repo = await getCurrentRepoFromRemote().then(
            (r) => `${r.owner}/${r.repo}`,
          ).catch(() => undefined);
          await promptAndAddToTodoList(
            [{ ref: explicitIssueUrl ?? effectivePlanFilePath, title }],
            {
              repo,
              updated: new Date().toISOString().slice(0, 10),
            },
          );
        }

        Deno.exit(0);
      },
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
