#!/usr/bin/env -S deno run --allow-all
// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0
/**
 * dn CLI - Main entry point
 *
 * A Deno CLI that exposes kickstart-style workflows as subcommands.
 *
 * Usage:
 *   dn kickstart <issue_url_or_number>    # Full kickstart workflow
 *   dn meld <source> [source ...]          # Plan phase
 *   dn loop <plan-file-or-issue>  # Loop phase only
 */

import { handleLand } from "./land.ts";
import { handleAuth } from "./auth.ts";
import { handleContext } from "./context.ts";
import { bootstrapFromEnv } from "./output.ts";
import { handleFixup } from "./fixup.ts";
import { handleInitAgents } from "./init-agents.ts";
import { handleInitStack } from "./init-stack.ts";
import { handleIssue } from "./issue.ts";
import { handleInitWorkflows, handleWorkflows } from "./workflows.ts";
import {
  type AgentHarness,
  parseAgentHarness,
} from "../sdk/github/agentHarness.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import { parseSandboxProvider } from "../sdk/sandbox/config.ts";
import denoConfig from "../deno.json" with { type: "json" };

async function handleInit(
  args: string[],
  globalAgent: AgentHarness | null,
): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "stack") {
    await handleInitStack(args.slice(1), globalAgent);
    return;
  }

  if (subcommand === "agents") {
    await handleInitAgents(args.slice(1));
    return;
  }

  if (subcommand === "workflows" || subcommand === "build") {
    await handleInitWorkflows(args.slice(1));
    return;
  }

  if (
    args.length === 0 || subcommand === "help" || subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log("dn init - Initialize repo context\n");
    console.log("Usage:");
    console.log("  dn init <subcommand> [options]\n");
    console.log("Subcommands:");
    console.log("  stack    Initialize stack context from GitHub milestone");
    console.log("  build    Install GitHub Actions workflow automation");
    console.log("  workflows Install canonical GitHub Actions workflows");
    console.log("  agents   Update AGENTS.md with dn instructions\n");
    console.log("Examples:");
    console.log("  dn init build");
    console.log("  dn init workflows");
    console.log("  dn init stack 42");
    console.log(
      "  dn init stack https://github.com/owner/repo/milestone/3",
    );
    Deno.exit(0);
  }

  console.error(`Unknown init subcommand: ${subcommand}\n`);
  console.error("Valid subcommands: stack, build, workflows, agents");
  Deno.exit(1);
}
import { handleKickstart } from "./kickstart.ts";
import { handleLoop } from "./loop.ts";
import { handleMeld } from "./meld.ts";
import { handleGlance } from "./glance.ts";
import { handlePeek } from "./peek.ts";
import { handleTodo } from "./todo.ts";
import { handleTidy } from "./tidy.ts";
import { handleRelease } from "./release.ts";
import { handleSync } from "./sync.ts";
import { handleUntil } from "./until.ts";
import { handleRunner } from "./runner.ts";

/**
 * Parses global flags from args and returns bootstrap options plus remaining args.
 * Global flags: --unattended, --ci (alias), --no-color, --color, --trace,
 * --no-trace, --version, -V.
 */
function parseGlobalFlags(
  args: string[],
): {
  unattended: boolean;
  noColor: boolean;
  forceColor: boolean;
  agentTrace: boolean | undefined;
  showVersion: boolean;
  agent: AgentHarness | null;
  sandbox: SandboxFlagValue | null;
  rest: string[];
} {
  let unattended = false;
  let noColor = false;
  let forceColor = false;
  let agentTrace: boolean | undefined;
  let showVersion = false;
  let agent: AgentHarness | null = null;
  let sandbox: SandboxFlagValue | null = null;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--unattended" || a === "--ci") {
      unattended = true;
    } else if (a === "--no-color") {
      noColor = true;
    } else if (a === "--color") {
      forceColor = true;
    } else if (a === "--trace") {
      agentTrace = true;
    } else if (a === "--no-trace") {
      agentTrace = false;
    } else if (a === "--version" || a === "-V") {
      showVersion = true;
    } else if (a === "--sandbox") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        sandbox = "from-config";
        continue;
      }
      const parsed = parseSandboxProvider(value);
      if (sandbox && sandbox !== parsed) {
        throw new Error(
          `Conflicting sandbox selections: ${sandbox} and ${parsed}. Select only one provider.`,
        );
      }
      sandbox = parsed;
      i++;
    } else if (a === "--agent") {
      if (i + 1 >= args.length) {
        throw new Error("Missing value for --agent");
      }
      const parsed = parseAgentHarness(args[++i]);
      if (agent && agent !== parsed) {
        throw new Error(
          `Conflicting agent selections: ${agent} and ${parsed}. Select only one agent.`,
        );
      }
      agent = parsed;
    } else if (a === "--opencode") {
      if (agent && agent !== "opencode") {
        throw new Error(
          `Conflicting agent selections: ${agent} and opencode. Select only one agent.`,
        );
      }
      agent = "opencode";
    } else if (a === "--cursor") {
      if (agent && agent !== "cursor") {
        throw new Error(
          `Conflicting agent selections: ${agent} and cursor. Select only one agent.`,
        );
      }
      agent = "cursor";
    } else if (a === "--claude") {
      if (agent && agent !== "claude") {
        throw new Error(
          `Conflicting agent selections: ${agent} and claude. Select only one agent.`,
        );
      }
      agent = "claude";
    } else if (a === "--codex") {
      if (agent && agent !== "codex") {
        throw new Error(
          `Conflicting agent selections: ${agent} and codex. Select only one agent.`,
        );
      }
      agent = "codex";
    } else if (a === "--copilot") {
      if (agent && agent !== "copilot") {
        throw new Error(
          `Conflicting agent selections: ${agent} and copilot. Select only one agent.`,
        );
      }
      agent = "copilot";
    } else {
      rest.push(...args.slice(i));
      break;
    }
  }
  return {
    unattended,
    noColor,
    forceColor,
    agentTrace,
    showVersion,
    agent,
    sandbox,
    rest,
  };
}

function parseBootstrapFlags(
  args: string[],
): {
  unattended: boolean;
  noColor: boolean;
  forceColor: boolean;
  agentTrace: boolean | undefined;
  rest: string[];
} {
  let unattended = false;
  let noColor = false;
  let forceColor = false;
  let agentTrace: boolean | undefined;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--unattended" || arg === "--ci") {
      unattended = true;
    } else if (arg === "--no-color") {
      noColor = true;
    } else if (arg === "--color") {
      forceColor = true;
    } else if (arg === "--trace") {
      agentTrace = true;
    } else if (arg === "--no-trace") {
      agentTrace = false;
    } else {
      rest.push(arg);
    }
  }
  return { unattended, noColor, forceColor, agentTrace, rest };
}

/**
 * Shows usage information
 */
function showUsage(): void {
  console.error("dn - A CLI for managing agentic workflows\n");
  console.error("Usage:");
  console.error("  dn [global options] <subcommand> [options]\n");
  console.error("Global options:");
  console.error(
    "  --agent <agent>   Agent to use for agent-backed workflows (opencode, cursor, claude, codex, copilot)",
  );
  console.error("  --opencode        Alias for --agent opencode");
  console.error("  --cursor          Alias for --agent cursor");
  console.error("  --claude          Alias for --agent claude");
  console.error("  --codex           Alias for --agent codex");
  console.error("  --copilot         Alias for --agent copilot");
  console.error(
    "  --sandbox <none|docker|exe.dev>  Sandbox provider (omit value to read config)",
  );
  console.error("  --unattended      Disable interactive output affordances");
  console.error(
    "  --trace           Stream agent harness stdout/stderr (default in CI)",
  );
  console.error(
    "  --no-trace        Suppress live agent stream (default in attended TTY)",
  );
  console.error("  --no-color        Disable color output");
  console.error("  --color           Force color output");
  console.error("  --version, -V     Print the version and exit\n");

  console.error("Subcommands:");
  console.error(
    "  auth         Sign in to GitHub in the browser (caches token for dn)",
  );
  console.error(
    "  context      Inspect inherited AGENTS.md context for a file or directory",
  );
  console.error(
    "  init         Initialize repo context (stack, workflows, agents)",
  );
  console.error(
    "    stack      Initialize stack context from GitHub milestone",
  );
  console.error(
    "    build      Install GitHub Actions workflow automation",
  );
  console.error(
    "    workflows  Install canonical GitHub Actions workflows",
  );
  console.error("    agents     Update AGENTS.md with dn instructions");
  console.error(
    "  issue        Manage GitHub issues and relationships",
  );
  console.error(
    "  workflows    Run, install, and manage GitHub Actions workflows",
  );
  console.error(
    "  kickstart    Run full kickstart workflow (plan + implement)",
  );
  console.error(
    "  loop         Run loop phase only (requires plan file from meld)",
  );
  console.error(
    "  until        Run bounded generator/verifier gambits until done",
  );
  console.error(
    "  fixup        Address PR feedback locally (fetch comments, plan, implement)",
  );
  console.error(
    "  glance       Project velocity overview",
  );
  console.error(
    "  peek         Suggest next open issues to prioritize (heuristic)",
  );
  console.error(
    "  meld         Plan from one or more sources and route the output",
  );
  console.error(
    "  land         Close out work into VCS commits; --issue-testplan updates GH issue",
  );
  console.error(
    "  todo         Manage prioritized task list (~/.dn/todo.md); 'done' marks item and closes issue",
  );
  console.error(
    "  tidy         Groom todo list: re-fetch issues, re-score, update ~/.dn/todo.md",
  );
  console.error(
    "  sync         Git/Sapling: lint, rebase onto main, publish local commits",
  );
  console.error(
    "  runner       Pair and operate this machine as Denoise infrastructure",
  );
  console.error(
    "  release      Manage GitHub releases (create, list, view, delete)\n",
  );
  console.error(
    "Use 'dn <subcommand> --help' for subcommand-specific options.",
  );
  Deno.exit(1);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  let args: string[];
  let globalAgent: AgentHarness | null;
  let globalSandbox: SandboxFlagValue | null;
  let unattended: boolean;
  let noColor: boolean;
  let forceColor: boolean;
  let agentTrace: boolean | undefined;
  let showVersion: boolean;
  try {
    ({
      unattended,
      noColor,
      forceColor,
      agentTrace,
      showVersion,
      agent: globalAgent,
      sandbox: globalSandbox,
      rest: args,
    } = parseGlobalFlags(Deno.args));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }

  if (showVersion) {
    console.log(denoConfig.version);
    return;
  }

  if (args.length === 0) {
    showUsage();
    return;
  }

  const subcommand = args[0];
  const rawSubcommandArgs = args.slice(1);

  // Bootstrap output policy once at CLI entry: set NO_COLOR in CI, then apply global flags
  bootstrapFromEnv();
  const {
    unattended: subcommandUnattended,
    noColor: subcommandNoColor,
    forceColor: subcommandForceColor,
    agentTrace: subcommandAgentTrace,
    rest: subcommandArgs,
  } = parseBootstrapFlags(rawSubcommandArgs);
  const resolvedAgentTrace = subcommandAgentTrace ?? agentTrace;
  bootstrapFromEnv({
    ...((unattended || subcommandUnattended) && { unattended: true }),
    ...((noColor || subcommandNoColor) && { noColor: true }),
    ...((forceColor || subcommandForceColor) && { forceColor: true }),
    ...(resolvedAgentTrace !== undefined && { agentTrace: resolvedAgentTrace }),
  });

  switch (subcommand) {
    case "auth":
      await handleAuth(subcommandArgs);
      break;
    case "context":
      await handleContext(subcommandArgs);
      break;
    case "init":
      await handleInit(subcommandArgs, globalAgent);
      break;
    case "issue":
    case "issues":
      await handleIssue(subcommandArgs);
      break;
    case "workflows":
      await handleWorkflows(subcommandArgs);
      break;
    case "kickstart":
      await handleKickstart(subcommandArgs, globalAgent, globalSandbox);
      break;
    case "loop":
      await handleLoop(subcommandArgs, globalAgent, globalSandbox);
      break;
    case "until":
      await handleUntil(subcommandArgs, globalAgent, globalSandbox);
      break;
    case "fixup":
      await handleFixup(subcommandArgs, globalAgent);
      break;
    case "meld":
      await handleMeld(subcommandArgs, globalAgent, globalSandbox);
      break;
    case "land":
      await handleLand(subcommandArgs, globalAgent);
      break;
    case "peek":
      await handlePeek(subcommandArgs);
      break;
    case "glance":
      await handleGlance(subcommandArgs);
      break;
    case "todo":
      await handleTodo(subcommandArgs);
      break;
    case "tidy":
      await handleTidy(subcommandArgs, globalAgent);
      break;
    case "sync":
      await handleSync(subcommandArgs);
      break;
    case "runner":
      await handleRunner(subcommandArgs);
      break;
    case "release":
    case "releases":
      await handleRelease(subcommandArgs);
      break;
    case "--help":
    case "-h":
    case "help":
      showUsage();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n`);
      showUsage();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // CLI boundary: print the message without a Deno "Uncaught (in promise)"
    // stack so launchd/systemd logs stay actionable.
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
