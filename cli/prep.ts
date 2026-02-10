// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn prep subcommand handler
 *
 * Runs only the plan phase (Steps 1-3: resolve issue, VCS prep, plan phase)
 * Also supports --update-issue mode to fill empty issue template sections
 */

import type { KickstartConfig, PlanPhaseResult } from "../kickstart/lib.ts";
import { fillEmptyIssueSections, runPlanPhase } from "../kickstart/lib.ts";
import { isGitHubIssueUrl } from "../sdk/meld/mod.ts";

/**
 * Extended config for prep command including update-issue mode
 */
interface PrepConfig extends KickstartConfig {
  issueUrl: string | null;
  updateIssue: boolean;
  dryRun: boolean;
}

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
 * Parses prep-specific arguments
 */
function parseArgs(args: string[]): PrepConfig {
  let input: string | null = null;
  let planName: string | null = null;
  let workspaceRoot: string | undefined = undefined;
  let updateIssue = false;
  let dryRun = false;
  let cursorEnabled = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--issue-url" && i + 1 < args.length) {
      input = args[++i];
    } else if (arg === "--plan-name" && i + 1 < args.length) {
      planName = args[++i];
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--update-issue" || arg === "--fill-template") {
      updateIssue = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--cursor" || arg === "-c") {
      cursorEnabled = true;
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

  return {
    awp: false,
    cursorEnabled,
    issueUrl,
    contextMarkdownPath,
    saveCtx: false,
    savedPlanName: planName,
    workspaceRoot,
    updateIssue,
    dryRun,
  };
}

/**
 * Shows help for prep subcommand
 */
function showHelp(): void {
  console.log("dn prep - Run plan phase or update issue description\n");
  console.log("Usage:");
  console.log(
    "  dn prep [options] <issue_url_or_number_or_markdown_file>\n",
  );
  console.log(
    "Argument: GitHub issue URL, issue number for current repo, or path to a .md file.",
  );
  console.log(
    "A path to a markdown file uses that file as context for the plan phase (no GitHub fetch).\n",
  );
  console.log("Modes:");
  console.log("  Default mode:    Run plan phase (Steps 1-3 of kickstart)");
  console.log(
    "  --update-issue:  Fill empty sections in issue template using LLM\n",
  );
  console.log("Options:");
  console.log(
    "  --issue-url <url>         GitHub issue URL, issue number, or path to markdown file",
  );
  console.log(
    "  --plan-name <name>        Plan name (prompts if not provided)",
  );

  console.log("  --workspace-root <path>   Workspace root directory");
  console.log(
    "  --cursor, -c              Use Cursor agent instead of opencode",
  );
  console.log(
    "  --update-issue            Fill empty sections in the issue template",
  );
  console.log(
    "  --fill-template           Alias for --update-issue",
  );
  console.log(
    "  --dry-run                 Preview changes without updating GitHub (use with --update-issue)",
  );
  console.log("  --help, -h                Show this help message\n");
  console.log("Environment variables:");
  console.log("  WORKSPACE_ROOT            Workspace root directory");
  console.log(
    "  ISSUE                     Issue URL, issue number, or path to markdown file (alternative to positional)",
  );
  console.log(
    "  CURSOR_ENABLED            Set to '1' to use Cursor agent instead of opencode\n",
  );
  console.log("Examples:");
  console.log("  # Run plan phase with opencode");
  console.log("  dn prep https://github.com/owner/repo/issues/123");
  console.log("  dn prep 123");
  console.log("  dn prep docs/spec.md");
  console.log("  dn prep --issue-url <url> --plan-name my-feature");
  console.log("");
  console.log("  # Run plan phase with Cursor agent");
  console.log("  dn prep --cursor https://github.com/owner/repo/issues/123");
  console.log("");
  console.log("  # Update issue description (fill empty template sections)");
  console.log("  dn prep --update-issue 123");
  console.log(
    "  dn prep --update-issue --dry-run 123   # Preview without updating",
  );
  console.log(
    "  dn prep --update-issue https://github.com/owner/repo/issues/123",
  );
}

/**
 * Handles the prep subcommand
 */
export async function handlePrep(args: string[]): Promise<void> {
  let config = parseArgs(args);

  if (config.updateIssue) {
    if (!config.issueUrl) {
      console.error(
        "Error: --update-issue requires an issue URL or issue number (not a markdown file path).",
      );
      console.error("\nUse 'dn prep --help' for usage information.");
      Deno.exit(1);
    }
  } else {
    if (!config.issueUrl && !config.contextMarkdownPath) {
      console.error(
        "Error: Provide an issue URL, issue number, or path to a markdown file (or set ISSUE).",
      );
      console.error("\nUse 'dn prep --help' for usage information.");
      Deno.exit(1);
    }
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

  // Handle --update-issue mode (issueUrl already validated above)
  if (config.updateIssue && config.issueUrl) {
    try {
      const workspaceRoot = config.workspaceRoot ||
        Deno.env.get("WORKSPACE_ROOT") || Deno.cwd();

      const result = await fillEmptyIssueSections(
        config.issueUrl,
        workspaceRoot,
        config.dryRun,
        config.cursorEnabled,
      );

      if (result.error) {
        console.error(`Error: ${result.error}`);
        Deno.exit(1);
      }

      if (result.updated) {
        console.log(
          `\nFilled sections: ${result.filledSections.join(", ") || "none"}`,
        );
        console.log(
          `Preserved sections: ${result.skippedSections.join(", ") || "none"}`,
        );
      } else if (result.filledSections.length > 0) {
        // Dry run mode with changes
        console.log(
          `\nWould fill sections: ${
            result.filledSections.join(", ") || "none"
          }`,
        );
        console.log(
          `Would preserve sections: ${
            result.skippedSections.join(", ") || "none"
          }`,
        );
      }

      Deno.exit(0);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }
  }

  // Default: run plan phase
  try {
    const result: PlanPhaseResult = await runPlanPhase(config);

    // Output plan file path for use by loop command
    console.log(`\n${result.planFilePath}`);

    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
