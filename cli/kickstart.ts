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
  markDone,
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
import {
  type AgentHarness,
  resolveAgentHarnessFromFlagsAndEnv,
} from "../sdk/github/agentHarness.ts";
import { parseMilestoneUrl } from "../sdk/github/milestone.ts";
import { parseFrontmatter } from "../sdk/todo/frontmatter.ts";
import {
  getStackArtifactPaths,
  markMilestoneStackItemDone,
  parseStackTodoItems,
} from "../sdk/github/stack.ts";

const ISSUE_NUMBER_PATTERN = /^#?\d+$/;

/** CLI-only fields layered on {@link KickstartConfig}. */
type KickstartCliConfig = KickstartConfig & {
  milestoneStackMarkdownPath?: string;
  /** When true with `--complete` and `--milestone`, skip milestone queue y/n prompts in this module. */
  milestoneAutoAdvance?: boolean;
  /** When true with `--milestone`, run the first unchecked stack item, mark it done, and exit. */
  milestoneRunOnce?: boolean;
};

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
function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null = null,
): KickstartCliConfig {
  let input: string | null = null;
  let awp = false;
  let cursorFlag = false;
  let claudeFlag = false;
  let codexFlag = false;
  let opencodeFlag = false;
  let allowCrossRepo = false;
  let savedPlanName: string | null = null;
  let workspaceRoot: string | undefined = undefined;
  let milestone: string | undefined = undefined;
  let milestoneAutoAdvance = false;
  let milestoneRunOnce = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--awp") {
      awp = true;
    } else if (arg === "--cursor" || arg === "-c") {
      cursorFlag = true;
    } else if (arg === "--claude") {
      claudeFlag = true;
    } else if (arg === "--codex") {
      codexFlag = true;
    } else if (arg === "--opencode") {
      opencodeFlag = true;
    } else if (arg === "--allow-cross-repo") {
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

  const { issueUrl, contextMarkdownPath } = input
    ? classifyInput(input)
    : { issueUrl: null as string | null, contextMarkdownPath: undefined };

  const agentHarness = resolveAgentHarnessFromFlagsAndEnv({
    agent: globalAgent,
    cursorFlag,
    claudeFlag,
    codexFlag,
    opencodeFlag,
  });

  const saveCtx = Deno.env.get("SAVE_CTX") === "1";

  return {
    awp,
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
    "  --awp                    Enable AWP mode (branches, commits, PRs)",
  );
  console.log(
    "  --allow-cross-repo       Allow implementing issues from different repositories",
  );
  console.log("  --cursor, -c              Use Cursor headless agent");
  console.log("  --claude                  Use Claude Code CLI (`claude -p`)");
  console.log("  --codex                   Use Codex CLI (`codex exec`)");
  console.log("  --opencode                Use OpenCode CLI (default)");
  console.log(
    "  --milestone <url-or-num>  Use milestone-linked stack file (plans/{owner}_{repo}_{milestone}.stack.md)",
  );
  console.log(
    "  --complete               With --milestone only: run all unchecked stack tasks without y/n prompts between them",
  );
  console.log(
    "  --once                   With --milestone only: run one unchecked stack task without y/n prompts",
  );
  console.log("  --saved-plan <name>      Use a specific plan name");
  console.log("  --workspace-root <path>  Workspace root directory");
  console.log("  --help, -h               Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT           Workspace root directory");
  console.log(
    "  ISSUE                    Issue URL, issue number, or path to markdown file (alternative to positional)",
  );
  console.log("  SAVE_CTX                 Set to '1' to preserve debug files");
  console.log(
    "  CURSOR_ENABLED           Set to '1' to use Cursor agent",
  );
  console.log(
    "  CLAUDE_ENABLED           Set to '1' to use Claude Code (not with CURSOR_ENABLED)\n",
  );
  console.log("  CODEX_ENABLED            Set to '1' to use Codex CLI\n");
  console.log("Examples:");
  console.log("  dn kickstart https://github.com/owner/repo/issues/123");
  console.log("  dn kickstart 123");
  console.log("  dn kickstart docs/spec.md");
  console.log("  dn kickstart --milestone 42");
  console.log(
    "  dn kickstart --milestone 42 --complete   # chain every unchecked stack item",
  );
  console.log(
    "  dn kickstart --awp --milestone 42 --once # one queued issue for CI",
  );
  console.log("  dn kickstart --awp --cursor <issue_url_or_number>");
  console.log("  dn kickstart --awp --claude <issue_url_or_number>");
  console.log("  dn --agent codex kickstart --awp <issue_url_or_number>");
  console.log("  ISSUE=<issue_url_or_number> dn kickstart");
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
  return { ...config, issueUrl: issueUrl ?? null, contextMarkdownPath };
}

/**
 * Handles the kickstart subcommand
 */
export async function handleKickstart(
  args: string[],
  globalAgent: AgentHarness | null = null,
): Promise<void> {
  let config: KickstartCliConfig;
  try {
    config = parseArgs(args, globalAgent);
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

  for (;;) {
    try {
      await runFullKickstart(config);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }

    const ref = config.issueUrl ?? config.contextMarkdownPath;
    if (!ref) break;

    const skipMilestoneQueuePrompts = Boolean(
      (config.milestoneAutoAdvance || config.milestoneRunOnce) &&
        config.milestoneStackMarkdownPath,
    );
    if (
      !skipMilestoneQueuePrompts &&
      !promptYesNo(`Mark ${ref} done and continue with next?`)
    ) {
      Deno.exit(0);
    }

    const updated = new Date().toISOString().slice(0, 10);
    const stackPath = config.milestoneStackMarkdownPath;

    try {
      if (stackPath) {
        await markMilestoneStackItemDone(stackPath, ref);
        const gh = await resolveGitHubRef(ref);
        if (gh) {
          await completeGitHubIssueForRef(gh, {
            closeComment: "Completed via dn kickstart",
          });
        }
        if (config.milestoneRunOnce) {
          console.log(
            "Completed one milestone stack task. Commit the updated stack file when ready.",
          );
          Deno.exit(0);
        }
        const stackContent = await Deno.readTextFile(stackPath);
        const { body } = parseFrontmatter(stackContent);
        const stackItems = parseStackTodoItems(body);
        const next = firstUnchecked({ meta: {}, items: stackItems });
        if (!next) {
          console.log(
            "No more unchecked tasks in this milestone stack. Commit the updated stack file when ready.",
          );
          Deno.exit(0);
        }
        if (
          !skipMilestoneQueuePrompts &&
          !promptYesNo(`Proceed with ${next.ref}?`)
        ) {
          Deno.exit(0);
        }
        const { issueUrl, contextMarkdownPath } = classifyInput(next.ref);
        config = {
          ...config,
          issueUrl: issueUrl ?? null,
          contextMarkdownPath,
          milestoneStackMarkdownPath: stackPath,
        };
      } else {
        await markDone(ref, { updated });
        const list = await readTodoList();
        const next = firstUnchecked(list);
        if (!next) {
          console.log(
            "No more items in todo. Run `dn kickstart` with a ticket or `dn tidy` to refresh.",
          );
          Deno.exit(0);
        }
        if (!promptYesNo(`Proceed with ${next.ref}?`)) {
          Deno.exit(0);
        }
        const { issueUrl, contextMarkdownPath } = classifyInput(next.ref);
        config = {
          ...config,
          issueUrl: issueUrl ?? null,
          contextMarkdownPath,
          milestoneStackMarkdownPath: undefined,
        };
      }
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
