// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn kickstart subcommand handler
 *
 * Runs the full kickstart workflow (plan + implement phases)
 */

import type { KickstartConfig } from "../kickstart/lib.ts";
import { runFullKickstart } from "../kickstart/lib.ts";
import { runScoring } from "../kickstart/score.ts";
import { isGitHubIssueUrl } from "../sdk/meld/mod.ts";
import {
  completeGitHubIssueForRef,
  firstUnchecked,
  readTodoList,
  resolveGitHubRef,
  type TodoItem,
  writeTodoList,
} from "../sdk/todo/todo.ts";
import { fetchIssueFromUrl } from "../sdk/github/issue.ts";
import {
  getCurrentRepoFromRemote,
  listIssues,
} from "../sdk/github/github-gql.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import { parseMilestoneUrl } from "../sdk/github/milestone.ts";
import { parseFrontmatter } from "../sdk/todo/frontmatter.ts";
import {
  getStackArtifactPaths,
  markMilestoneStackItemDone,
  parseStackTodoItems,
} from "../sdk/github/stack.ts";
import { isCI } from "../sdk/github/output.ts";
import type { PublishMode } from "../sdk/github/publish.ts";
import { parsePublishMode } from "../sdk/github/publish.ts";
import {
  denoiseTaskToMarkdown,
  validateDenoiseTaskDocument,
} from "../sdk/runner/types.ts";
import {
  detectVcs,
  getChangedFiles,
  publishStackProgressUpdate,
} from "../sdk/github/vcs.ts";
import { writeGithubActionVcsOutputs } from "../sdk/github/publish.ts";
import { formatInfo, formatWarning } from "./output.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import {
  extractSandboxFlag,
  resolveSandboxFlagValue,
} from "../sdk/sandbox/cli.ts";
import { resolveSandboxConfig } from "../sdk/sandbox/resolve.ts";
import { runWithSandboxLifecycle } from "../sdk/sandbox/lifecycle.ts";
import {
  buildCursorCloudKickstartPrompt,
  cursorCloudRepositoryUrlFromIssue,
  DEFAULT_CURSOR_CLOUD_REF,
  parseCursorCloudRef,
  requireCursorApiKey,
  runCursorCloudAgentTracked,
} from "../sdk/github/cursorCloudAgent.ts";

const ISSUE_NUMBER_PATTERN = /^#?\d+$/;

/** CLI-only fields layered on {@link KickstartConfig}. */
type KickstartCliConfig = KickstartConfig & {
  /** Dispatch the work to a durable Cursor Cloud Agent instead of a local harness. */
  cursorCloud: boolean;
  /** Remote Git ref cloned into the Cursor Cloud Agent workspace. */
  cursorCloudRef: string;
  milestoneStackMarkdownPath?: string;
  /** When true with `--complete` and `--milestone`, skip milestone queue y/n prompts in this module. */
  milestoneAutoAdvance?: boolean;
  /** When true with `--milestone`, run the first unchecked stack item, mark it done, and exit. */
  milestoneRunOnce?: boolean;
  /** Path to a denoise task JSON file for ticketless kickstart. */
  denoiseTaskPath?: string;
  /** True when the issue/context was chosen from the todo list or milestone stack. */
  fromQueue?: boolean;
};

function parseVerbosity(value: string | undefined): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(
    `--verbosity requires one of: low, medium, high (received ${
      value ?? "no value"
    }).`,
  );
}

function classifyInput(input: string): {
  issueUrl: string | null;
  contextMarkdownPath?: string;
} {
  const trimmed = input.trim();
  if (isGitHubIssueUrl(trimmed) || ISSUE_NUMBER_PATTERN.test(trimmed)) {
    return { issueUrl: trimmed, contextMarkdownPath: undefined };
  }
  return { issueUrl: null, contextMarkdownPath: trimmed };
}

/**
 * Parses kickstart-specific arguments
 */
export async function parseKickstartArgs(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): Promise<KickstartCliConfig> {
  let input: string | null = null;
  let publish: PublishMode = "none";
  let publishSpecified = false;
  let cursorFlag = false;
  let claudeFlag = false;
  let codexFlag = false;
  let copilotFlag = false;
  let opencodeFlag = false;
  let cursorCloud = false;
  let cursorCloudRef = DEFAULT_CURSOR_CLOUD_REF;
  let cursorCloudRefSpecified = false;
  let allowCrossRepo = false;
  let savedPlanName: string | null = null;
  let workspaceRoot: string | undefined = undefined;
  let milestone: string | undefined = undefined;
  let milestoneAutoAdvance = false;
  let milestoneRunOnce = false;
  let denoiseTaskPath: string | undefined = undefined;
  let steeringPrompt: string | undefined = undefined;
  let verbosity: "low" | "medium" | "high" = "medium";
  let skipPlan = false;

  const { sandbox: localSandbox, rest: flagArgs } = extractSandboxFlag(args);
  const sandboxFlag = resolveSandboxFlagValue(globalSandbox, localSandbox);

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--awp") {
      publish = "pr";
      publishSpecified = true;
    } else if (arg === "--publish" && i + 1 < args.length) {
      publish = parsePublishMode(args[++i]);
      publishSpecified = true;
    } else if (arg === "--cursor" || arg === "-c") {
      cursorFlag = true;
    } else if (arg === "--cursor-cloud") {
      cursorCloud = true;
    } else if (arg === "--ref") {
      cursorCloudRef = parseCursorCloudRef(flagArgs[++i]);
      cursorCloudRefSpecified = true;
    } else if (arg === "--claude") {
      claudeFlag = true;
    } else if (arg === "--codex") {
      codexFlag = true;
    } else if (arg === "--copilot") {
      copilotFlag = true;
    } else if (arg === "--opencode") {
      opencodeFlag = true;
    } else if (arg === "--allow-cross-repo" || arg === "-A") {
      allowCrossRepo = true;
    } else if (arg === "--complete") {
      milestoneAutoAdvance = true;
    } else if (arg === "--once") {
      milestoneRunOnce = true;
    } else if (arg === "--saved-plan" && i + 1 < args.length) {
      savedPlanName = args[++i];
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--milestone" && i + 1 < args.length) {
      milestone = args[++i];
    } else if (arg === "--denoise-task" && i + 1 < args.length) {
      denoiseTaskPath = args[++i];
    } else if (arg === "--steer") {
      if (i + 1 >= flagArgs.length) {
        throw new Error("--steer requires a value.");
      }
      steeringPrompt = flagArgs[++i];
    } else if (arg === "--verbosity") {
      verbosity = parseVerbosity(flagArgs[++i]);
    } else if (arg === "--skip-plan") {
      skipPlan = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--") && !input) {
      input = arg;
    }
  }

  if (!input) {
    input = Deno.env.get("ISSUE") || null;
  }

  let denoiseTaskMaterialized = false;
  let denoiseTaskFilePath: string | undefined;

  if (denoiseTaskPath) {
    const jsonText = Deno.readTextFileSync(denoiseTaskPath);
    const task = validateDenoiseTaskDocument(JSON.parse(jsonText));
    const markdown = denoiseTaskToMarkdown(task);
    const tmpFile = Deno.makeTempFileSync({
      prefix: "dn-denoise-task-",
      suffix: ".md",
    });
    Deno.writeTextFileSync(tmpFile, markdown);
    denoiseTaskMaterialized = true;
    denoiseTaskFilePath = tmpFile;
  }

  const { issueUrl, contextMarkdownPath } = denoiseTaskMaterialized
    ? {
      issueUrl: null as string | null,
      contextMarkdownPath: denoiseTaskFilePath,
    }
    : input
    ? classifyInput(input)
    : { issueUrl: null as string | null, contextMarkdownPath: undefined };

  const agentHarness = await resolveLocalAgentHarness({
    repoRoot: workspaceRoot ?? Deno.cwd(),
    agent: globalAgent,
    cursorFlag,
    claudeFlag,
    codexFlag,
    copilotFlag,
    opencodeFlag,
  });

  if (
    cursorCloud &&
    (globalAgent !== null || cursorFlag || claudeFlag || codexFlag ||
      copilotFlag || opencodeFlag)
  ) {
    throw new Error(
      "--cursor-cloud cannot be combined with --agent or local agent flags.",
    );
  }
  if (cursorCloudRefSpecified && !cursorCloud) {
    throw new Error("--ref requires --cursor-cloud.");
  }
  if (cursorCloud) {
    if (publishSpecified && publish !== "pr") {
      throw new Error(
        "--cursor-cloud requires --publish pr; none and direct are available only for local CLI execution.",
      );
    }
    publish = "pr";
  }

  const saveCtx = Deno.env.get("SAVE_CTX") === "1";

  return {
    publish,
    agentHarness,
    allowCrossRepo,
    issueUrl,
    contextMarkdownPath,
    saveCtx,
    savedPlanName,
    workspaceRoot,
    milestone,
    ...(milestoneAutoAdvance ? { milestoneAutoAdvance: true } : {}),
    ...(milestoneRunOnce ? { milestoneRunOnce: true } : {}),
    sandboxFlag,
    cursorCloud,
    cursorCloudRef,
    ...(denoiseTaskPath ? { denoiseTaskPath } : {}),
    ...(steeringPrompt !== undefined ? { steeringPrompt } : {}),
    verbosity,
    skipPlan,
  };
}

/**
 * Shows help for kickstart subcommand
 */
function showHelp(): void {
  console.log("dn kickstart - Run full kickstart workflow\n");
  console.log("Usage:");
  console.log(
    "  dn kickstart [options] <issue_url_or_number_or_markdown_file>\n",
  );
  console.log(
    "Argument: GitHub issue URL, issue number for current repo, or path to a .md file.",
  );
  console.log(
    "A path to a markdown file uses that file as context (no GitHub fetch). AWP is not used when context is from a file.\n",
  );
  console.log("Options:");
  console.log(
    "  --publish <none|pr|direct> How to publish changes (default: none)",
  );
  console.log(
    "  --awp                    Alias for --publish pr (branches, commits, PRs)",
  );
  console.log(
    "  --allow-cross-repo, -A   Allow implementing issues from different repositories",
  );
  console.log(
    "  --steer <prompt>         Append supplemental operator guidance to agent prompts",
  );
  console.log(
    "  --verbosity <low|medium|high>  Plan prompt detail level (default: medium)",
  );
  console.log(
    "  --skip-plan              Skip plan generation and run the implementation phase",
  );
  console.log("  --cursor, -c              Use Cursor headless agent");
  console.log(
    "  --cursor-cloud            Queue a durable Cursor Cloud Agent run (requires CURSOR_API_KEY)",
  );
  console.log(
    "  --ref <git-ref>           Cloud repository starting ref (default: main; requires --cursor-cloud)",
  );
  console.log("  --claude                  Use Claude Code CLI (`claude -p`)");
  console.log("  --codex                   Use Codex CLI (`codex exec`)");
  console.log(
    "  --copilot                 Use GitHub Copilot CLI (`copilot -p`)",
  );
  console.log("  --opencode                Use OpenCode CLI (default)");
  console.log(
    "  --sandbox <none|docker|exe.dev>  Sandbox provider (global --sandbox also supported)",
  );
  console.log(
    "  --milestone <url-or-num>  Use milestone-linked stack file (plans/{owner}_{repo}_{milestone}.stack.md)",
  );
  console.log(
    "  --complete               With --milestone only: run all unchecked stack tasks without y/n prompts (requires --publish pr|direct)",
  );
  console.log(
    "  --once                   With --milestone only: run one unchecked stack task without y/n prompts",
  );
  console.log("  --saved-plan <name>      Use a specific plan name");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log(
    "  --denoise-task <file>    Materialize a denoise task JSON file as context (no GitHub fetch)",
  );
  console.log("  --help, -h               Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT           Workspace root directory");
  console.log(
    "  ISSUE                    Issue URL, issue number, or path to markdown file (alternative to positional)",
  );
  console.log("  SAVE_CTX                 Set to '1' to preserve debug files");
  console.log(
    "  EDITOR                   Open the generated plan for review in attended runs (e.g. 'code --wait' or vim)",
  );
  console.log(
    "  CURSOR_ENABLED           Set to '1' to use Cursor agent",
  );
  console.log(
    "  CLAUDE_ENABLED           Set to '1' to use Claude Code (not with CURSOR_ENABLED)\n",
  );
  console.log("  CODEX_ENABLED            Set to '1' to use Codex CLI\n");
  console.log(
    "  COPILOT_ENABLED          Set to '1' to use GitHub Copilot CLI\n",
  );
  console.log("Examples:");
  console.log("  dn kickstart https://github.com/owner/repo/issues/123");
  console.log("  dn kickstart 123");
  console.log("  dn kickstart docs/spec.md");
  console.log("  dn kickstart --milestone 42");
  console.log(
    "  dn kickstart --publish pr --milestone 42 --complete  # chain every unchecked stack item",
  );
  console.log(
    "  dn kickstart --awp --milestone 42 --once # one queued issue for CI",
  );
  console.log("  dn kickstart --awp --cursor <issue_url_or_number>");
  console.log(
    "  dn kickstart --cursor-cloud --publish pr <issue_url_or_number>",
  );
  console.log("  dn kickstart --awp --claude <issue_url_or_number>");
  console.log("  dn kickstart --awp --codex <issue_url_or_number>");
  console.log(
    "  dn kickstart --denoise-task task.json               # ticketless from JSON",
  );
  console.log(
    "  dn kickstart --awp --denoise-task task.json         # ticketless with PR",
  );
  console.log("  ISSUE=<issue_url_or_number> dn kickstart");
  console.log(
    '  dn kickstart --steer "Focus on the parser and add regression tests" 123',
  );
}

async function dispatchCursorCloudKickstart(
  config: KickstartCliConfig,
): Promise<void> {
  if (config.publish !== "pr") {
    throw new Error(
      "--cursor-cloud requires --publish pr; none and direct are available only for local CLI execution.",
    );
  }
  requireCursorApiKey();
  const issueRepositoryUrl = cursorCloudRepositoryUrlFromIssue(
    config.issueUrl,
  );
  let repositoryUrl: string;
  if (issueRepositoryUrl) {
    repositoryUrl = issueRepositoryUrl;
  } else {
    const repo = await getCurrentRepoFromRemote();
    repositoryUrl = `https://github.com/${repo.owner}/${repo.repo}.git`;
  }

  let context = config.issueUrl ? `GitHub issue: ${config.issueUrl}` : "";
  if (config.contextMarkdownPath) {
    context = await Deno.readTextFile(config.contextMarkdownPath);
  }
  if (!context) {
    throw new Error(
      "--cursor-cloud requires an issue or markdown context file.",
    );
  }

  const autoCreatePr = config.publish === "pr";
  const result = await runCursorCloudAgentTracked({
    prompt: buildCursorCloudKickstartPrompt(
      context,
      autoCreatePr,
      config.steeringPrompt,
    ),
    repository: { url: repositoryUrl, startingRef: config.cursorCloudRef },
    autoCreatePr,
  });
  if (result.waited) {
    const prSuffix = result.prUrl ? ` PR: ${result.prUrl}` : "";
    console.log(
      `Cursor Cloud Agent run ${result.runId} (agent ${result.agentId}) ${result.status}.${prSuffix}`,
    );
    return;
  }
  console.log(
    `Queued Cursor Cloud Agent run ${result.runId} (agent ${result.agentId}). The run continues on Cursor's cloud VM after dn exits.`,
  );
}

function promptYesNo(message: string, defaultNo = true): boolean {
  const suffix = defaultNo ? " (y/n): " : " (y/n): ";
  const answer = prompt(message + suffix)?.trim().toLowerCase();
  if (!answer) return !defaultNo;
  return answer === "y" || answer === "yes";
}

/**
 * No-ticket flow: read list first; if it has an unchecked item, use it (one "Proceed?" prompt).
 * Only if list is empty, prompt to search repo, then score and write list.
 */
async function runNoTicketFlow(
  config: KickstartCliConfig,
): Promise<KickstartCliConfig | null> {
  const workspaceRoot = config.workspaceRoot ??
    Deno.env.get("WORKSPACE_ROOT") ?? Deno.cwd();

  if (config.milestone) {
    const parsedUrl = parseMilestoneUrl(config.milestone);
    const milestoneNum = config.milestone.match(/^\d+$/)
      ? parseInt(config.milestone, 10)
      : parsedUrl?.number;
    if (!milestoneNum) {
      console.error(
        `Invalid milestone: ${config.milestone}. Provide a milestone URL or number.`,
      );
      return null;
    }

    const repoRef = parsedUrl ?? await getCurrentRepoFromRemote();
    const planPath = getStackArtifactPaths(
      workspaceRoot,
      repoRef.owner,
      repoRef.repo,
      milestoneNum,
    ).markdownPath;

    try {
      const content = await Deno.readTextFile(planPath);
      const { frontmatter, body } = parseFrontmatter(content);

      const items: TodoItem[] = parseStackTodoItems(body);

      const list = { meta: frontmatter, items };
      const suggested = firstUnchecked(list);

      if (!suggested) {
        console.log(`No unchecked items in ${planPath}.`);
        console.log(
          "Run 'dn init stack --milestone <num>' to refresh the list.",
        );
        return null;
      }

      const ref = suggested.ref;
      if (
        !config.milestoneAutoAdvance &&
        !config.milestoneRunOnce &&
        !promptYesNo(`Proceed with ${ref}?`)
      ) {
        console.error("Cancelled.");
        return null;
      }

      return {
        ...config,
        issueUrl: ref,
        contextMarkdownPath: undefined,
        milestoneStackMarkdownPath: planPath,
        fromQueue: true,
      };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        console.error(`Plan file not found: ${planPath}`);
        console.error(
          "Run 'dn init stack <num-or-url>' first to create it.",
        );
        return null;
      }
      throw e;
    }
  }

  let list = await readTodoList();
  let suggested = firstUnchecked(list);

  if (!suggested) {
    if (
      !promptYesNo("List is empty. Search this repo for a ticket to suggest?")
    ) {
      console.error(
        "Pass an issue URL, issue number, or path to a markdown file (or set ISSUE). Add items to ~/.dn/todo.md or run dn tidy.",
      );
      return null;
    }
    const { owner, repo } = await getCurrentRepoFromRemote();
    const issues = await listIssues(owner, repo, { state: "open", limit: 5 });
    const withBodies = await Promise.all(
      issues.map(async (i) => {
        const data = await fetchIssueFromUrl(i.url);
        return { ref: i.url, title: data.title, body: data.body };
      }),
    );
    const planPaths: { ref: string; title: string }[] = [];
    try {
      const plansDir = `${workspaceRoot}/plans`;
      const dir = await Deno.readDir(plansDir);
      for await (const e of dir) {
        if (e.isFile && e.name.endsWith(".plan.md")) {
          const path = `plans/${e.name}`;
          const content = await Deno.readTextFile(`${plansDir}/${e.name}`)
            .catch(() => "");
          const titleMatch = content.match(/^#\s+(.+)$/m);
          planPaths.push({
            ref: path,
            title: titleMatch ? titleMatch[1] : path,
          });
        }
      }
    } catch {
      // no plans dir
    }

    const scoring = await runScoring(
      workspaceRoot,
      withBodies,
      planPaths,
      config.agentHarness,
    );
    const scoredItems: TodoItem[] = scoring.scored
      .filter((s) => !s.disqualified && s.score != null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((s) => {
        const issue = withBodies.find((i) => i.ref === s.ref) ??
          planPaths.find((p) => p.ref === s.ref);
        return {
          checked: false,
          score: s.score,
          ref: s.ref,
          title: issue?.title ?? s.reason,
        };
      });
    list = {
      meta: {
        repo: `${owner}/${repo}`,
        updated: new Date().toISOString().slice(0, 10),
      },
      items: scoredItems,
    };
    await writeTodoList(list);
    suggested = firstUnchecked(list);
  }

  if (!suggested) {
    console.error(
      "No suggested task. Add items to ~/.dn/todo.md or pass a ticket.",
    );
    return null;
  }

  const ref = suggested.ref;
  if (!promptYesNo(`Proceed with ${ref}?`)) {
    console.error("Cancelled.");
    return null;
  }

  const { issueUrl, contextMarkdownPath } = classifyInput(ref);
  return {
    ...config,
    issueUrl: issueUrl ?? null,
    contextMarkdownPath,
    fromQueue: true,
  };
}

/**
 * Warns when a publish:none kickstart would stack onto an existing dirty tree
 * that already has a plan file — `dn land` only targets one plan at a time.
 */
async function warnStackedUnlandedWork(repoRoot: string): Promise<void> {
  const previousCwd = Deno.cwd();
  try {
    Deno.chdir(repoRoot);
    const plansDir = `${repoRoot}/plans`;
    let planCount = 0;
    for await (const entry of Deno.readDir(plansDir)) {
      if (
        entry.isFile &&
        entry.name.endsWith(".plan.md") &&
        !entry.name.includes(".test.")
      ) {
        planCount++;
      }
    }
    if (planCount === 0) return;

    const vcsContext = await detectVcs();
    if (!vcsContext) return;
    const changed = await getChangedFiles(vcsContext.vcs);
    if (changed.length === 0) return;

    console.warn(
      formatWarning(
        `Workspace already has uncommitted changes and ${planCount} plan file(s). ` +
          "`dn land` targets one plan at a time; stacked kickstarts can mis-attribute commits. " +
          "Run `dn land` first, or use `--publish pr|direct` for per-issue publish.",
      ),
    );
  } catch {
    // Non-blocking advisory only
  } finally {
    try {
      Deno.chdir(previousCwd);
    } catch {
      // ignore restore failures
    }
  }
}

/**
 * Handles the kickstart subcommand
 */
export async function handleKickstart(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): Promise<void> {
  let config: KickstartCliConfig;
  try {
    config = await parseKickstartArgs(args, globalAgent, globalSandbox);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }

  if (config.milestoneAutoAdvance) {
    if (!config.milestone) {
      console.error(
        "--complete requires --milestone <number-or-url>.",
      );
      Deno.exit(1);
    }
    if (config.publish === "none") {
      console.error(
        "--complete requires --publish pr or --publish direct so each stack item is published before the next (dn land only targets one plan at a time).",
      );
      Deno.exit(1);
    }
    if (config.issueUrl || config.contextMarkdownPath) {
      console.error(
        "--complete only applies when no issue argument or ISSUE is set (use `dn kickstart --milestone …` alone to pick from the stack file).",
      );
      Deno.exit(1);
    }
  }
  if (config.milestoneRunOnce) {
    if (!config.milestone) {
      console.error(
        "--once requires --milestone <number-or-url>.",
      );
      Deno.exit(1);
    }
    if (config.milestoneAutoAdvance) {
      console.error("--once cannot be combined with --complete.");
      Deno.exit(1);
    }
    if (config.issueUrl || config.contextMarkdownPath) {
      console.error(
        "--once only applies when no issue argument or ISSUE is set (use `dn kickstart --milestone … --once` to pick from the stack file).",
      );
      Deno.exit(1);
    }
  }

  if (!config.issueUrl && !config.contextMarkdownPath) {
    const resolved = await runNoTicketFlow(config);
    if (!resolved) Deno.exit(1);
    config = resolved;
  }

  if (config.contextMarkdownPath) {
    try {
      const resolved = await Deno.realPath(config.contextMarkdownPath);
      const stat = await Deno.stat(resolved);
      if (!stat.isFile) {
        console.error(`Error: Not a file: ${config.contextMarkdownPath}`);
        Deno.exit(1);
      }
      config = { ...config, contextMarkdownPath: resolved };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        console.error(
          `Error: Markdown file not found: ${config.contextMarkdownPath}`,
        );
      } else {
        console.error(e instanceof Error ? e.message : String(e));
      }
      Deno.exit(1);
    }
  }

  if (config.cursorCloud) {
    try {
      await dispatchCursorCloudKickstart(config);
      return;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }
  }

  for (;;) {
    const repoRoot = config.workspaceRoot ?? Deno.cwd();
    if (config.publish === "none") {
      await warnStackedUnlandedWork(repoRoot);
    }
    const { provider, config: sandboxConfig } = await resolveSandboxConfig(
      repoRoot,
      config.sandboxFlag,
    );
    if (
      provider === "exe.dev" &&
      (config.publish !== "pr" || config.issueUrl === null)
    ) {
      console.error(
        "exe.dev sandbox kickstart runs require a GitHub issue and --publish pr so remote work is persisted on a topic branch.",
      );
      Deno.exit(1);
    }
    const currentRef = config.issueUrl ?? config.contextMarkdownPath;
    const stackPathForRun = config.milestoneStackMarkdownPath;
    let originalStackContent: string | undefined;
    let stackProgressIncludedInPr = false;
    if (config.publish === "pr" && stackPathForRun && currentRef) {
      originalStackContent = await Deno.readTextFile(stackPathForRun);
      await markMilestoneStackItemDone(stackPathForRun, currentRef);
      stackProgressIncludedInPr = true;
    }
    try {
      await runWithSandboxLifecycle(
        { repoRoot, config: sandboxConfig, provider },
        async () => {
          await runFullKickstart(config);
        },
      );
    } catch (error) {
      if (originalStackContent !== undefined && stackPathForRun) {
        await Deno.writeTextFile(stackPathForRun, originalStackContent);
      }
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }

    const ref = config.issueUrl ?? config.contextMarkdownPath;
    if (!ref) break;

    const isBatchQueue = Boolean(
      (config.milestoneAutoAdvance || config.milestoneRunOnce) &&
        config.milestoneStackMarkdownPath,
    );

    // Attended runs: silent exit. Closing/checkoff is left to dn land,
    // --publish, dn todo done, or --once/--complete automation.
    if (!isBatchQueue) {
      if (config.publish === "none" && config.fromQueue) {
        if (config.milestoneStackMarkdownPath) {
          console.log(
            formatInfo(
              "Queue item left unchecked. After reviewing and landing, update the milestone stack (or re-run with --once/--complete --publish).",
            ),
          );
        } else {
          console.log(
            formatInfo(
              "Queue item left unchecked. After reviewing and landing, run `dn todo done` to check it off and close the GitHub issue if applicable.",
            ),
          );
        }
      }
      Deno.exit(0);
    }

    const stackPath = config.milestoneStackMarkdownPath;
    if (!stackPath) {
      Deno.exit(0);
    }

    try {
      const shouldPublishStack = config.publish !== "none" || isCI();
      if (stackProgressIncludedInPr) {
        console.log(
          "Milestone stack progress is included in the implementation PR.",
        );
      } else if (shouldPublishStack) {
        const stackRepoRoot = config.workspaceRoot ?? Deno.cwd();
        const stackResult = await publishStackProgressUpdate(
          stackRepoRoot,
          stackPath,
          ref,
          `dn: mark milestone stack item done (${ref})`,
        );
        await writeGithubActionVcsOutputs({
          ...stackResult,
          publishMode: "direct",
        });
        console.log(
          `Published stack progress to ${stackResult.branchName} (${
            stackResult.commitSha.slice(0, 7)
          }).`,
        );
      } else {
        await markMilestoneStackItemDone(stackPath, ref);
      }
      const gh = await resolveGitHubRef(ref);
      if (gh) {
        await completeGitHubIssueForRef(gh, {
          closeComment: "Completed via dn kickstart",
        });
      }
      if (config.milestoneRunOnce) {
        if (!shouldPublishStack) {
          console.log(
            "Completed one milestone stack task. Commit the updated stack file when ready.",
          );
        } else {
          console.log("Completed one milestone stack task.");
        }
        Deno.exit(0);
      }
      const stackContent = await Deno.readTextFile(stackPath);
      const { body } = parseFrontmatter(stackContent);
      const stackItems = parseStackTodoItems(body);
      const next = firstUnchecked({ meta: {}, items: stackItems });
      if (!next) {
        if (!shouldPublishStack) {
          console.log(
            "No more unchecked tasks in this milestone stack. Commit the updated stack file when ready.",
          );
        } else {
          console.log("No more unchecked tasks in this milestone stack.");
        }
        Deno.exit(0);
      }
      // --complete: auto-advance without prompts
      const { issueUrl, contextMarkdownPath } = classifyInput(next.ref);
      config = {
        ...config,
        issueUrl: issueUrl ?? null,
        contextMarkdownPath,
        milestoneStackMarkdownPath: stackPath,
        fromQueue: true,
      };
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      Deno.exit(1);
    }

    if (config.contextMarkdownPath) {
      try {
        const resolved = await Deno.realPath(config.contextMarkdownPath);
        const stat = await Deno.stat(resolved);
        if (!stat.isFile) {
          console.error(`Error: Not a file: ${config.contextMarkdownPath}`);
          Deno.exit(1);
        }
        config = { ...config, contextMarkdownPath: resolved };
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          console.error(
            `Error: Markdown file not found: ${config.contextMarkdownPath}`,
          );
        } else {
          console.error(e instanceof Error ? e.message : String(e));
        }
        Deno.exit(1);
      }
    }
  }

  Deno.exit(0);
}
