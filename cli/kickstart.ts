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
  firstUnchecked,
  readTodoList,
  type TodoItem,
  writeTodoList,
} from "../sdk/todo/todo.ts";
import { fetchIssueFromUrl } from "../sdk/github/issue.ts";
import {
  getCurrentRepoFromRemote,
  listIssues,
} from "../sdk/github/github-gql.ts";

const ISSUE_NUMBER_PATTERN = /^#?\d+$/;

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
function parseArgs(args: string[]): KickstartConfig {
  let input: string | null = null;
  let awp = false;
  let cursorEnabled = false;
  let allowCrossRepo = false;
  let savedPlanName: string | null = null;
  let workspaceRoot: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--awp") {
      awp = true;
    } else if (arg === "--cursor" || arg === "-c") {
      cursorEnabled = true;
    } else if (arg === "--allow-cross-repo") {
      allowCrossRepo = true;
    } else if (arg === "--saved-plan" && i + 1 < args.length) {
      savedPlanName = args[++i];
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
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

  if (!cursorEnabled) {
    cursorEnabled = Deno.env.get("CURSOR_ENABLED") === "1";
  }

  const saveCtx = Deno.env.get("SAVE_CTX") === "1";

  return {
    awp,
    cursorEnabled,
    allowCrossRepo,
    issueUrl,
    contextMarkdownPath,
    saveCtx,
    savedPlanName,
    workspaceRoot,
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
  console.log("  --cursor, -c              Enable Cursor IDE integration");
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
    "  CURSOR_ENABLED           Set to '1' to enable Cursor integration\n",
  );
  console.log("Examples:");
  console.log("  dn kickstart https://github.com/owner/repo/issues/123");
  console.log("  dn kickstart 123");
  console.log("  dn kickstart docs/spec.md");
  console.log("  dn kickstart --awp --cursor <issue_url_or_number>");
  console.log("  ISSUE=<issue_url_or_number> dn kickstart");
}

function promptYesNo(message: string, defaultNo = true): boolean {
  const suffix = defaultNo ? " (y/n): " : " (y/n): ";
  const answer = prompt(message + suffix)?.trim().toLowerCase();
  if (!answer) return !defaultNo;
  return answer === "y" || answer === "yes";
}

/**
 * No-ticket flow: suggest from todo list or search repo, then return config for the chosen ref.
 */
async function runNoTicketFlow(
  config: KickstartConfig,
): Promise<KickstartConfig | null> {
  if (!promptYesNo("No ticket given. Suggest a task from your list?")) {
    console.error(
      "Pass an issue URL, issue number, or path to a markdown file (or set ISSUE).",
    );
    return null;
  }

  const workspaceRoot = config.workspaceRoot ??
    Deno.env.get("WORKSPACE_ROOT") ?? Deno.cwd();
  let list = await readTodoList();
  let suggested = firstUnchecked(list);

  if (!suggested) {
    if (
      !promptYesNo("List is empty. Search this repo for a ticket to suggest?")
    ) {
      console.error("Add items to ~/.dn/todo.md or pass a ticket.");
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
      config.cursorEnabled,
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
export async function handleKickstart(args: string[]): Promise<void> {
  let config = parseArgs(args);

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

  try {
    await runFullKickstart(config);
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
