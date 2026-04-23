#!/usr/bin/env -S deno run --allow-all
// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Process a GitHub issue using opencode with two-phase execution (Plan → Implement).
 *
 * Usage (compiled binary):
 *   # Default mode: Apply changes locally (no branches/PRs)
 *   ./kickstart <issue_url>
 *
 *   # AWP mode: Full guided workflow (branches, commits, PRs)
 *   ./kickstart --awp <issue_url>
 *
 * Compile the binary:
 *   make compile_kickstart
 *
 * Development mode (run directly):
 *   deno run --allow-all kickstart/kickstart.ts <issue_url>
 *
 * Environment variables:
 *   ISSUE: GitHub issue URL (alternative to positional arg)
 *   SAVE_CTX: set to "1" to preserve debug files on success
 */

import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { resolveAgentHarnessFromFlagsAndEnv } from "../sdk/github/agentHarness.ts";
import { type OrchestratorConfig, runOrchestrator } from "./orchestrator.ts";

/**
 * Parses command-line arguments to extract flags and issue source.
 *
 * @returns Object with awp mode flag, agent harness, issue URL, and plan options
 */
function parseArgs(): {
  awp: boolean;
  agentHarness: AgentHarness;
  issueUrl: string | null;
  savedPlanName: string | null;
} {
  const args = Deno.args;
  let awp = false;
  let cursorFlag = false;
  let claudeFlag = false;
  let codexFlag = false;
  let opencodeFlag = false;
  let issueUrl: string | null = null;
  let savedPlanName: string | null = null;

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
    } else if (arg === "--saved-plan" && i + 1 < args.length) {
      savedPlanName = args[++i];
    } else if (!arg.startsWith("--") && !issueUrl) {
      // First non-flag argument is treated as issue URL
      issueUrl = arg;
    }
  }

  // Fallback to environment variable for issue URL
  if (!issueUrl) {
    issueUrl = Deno.env.get("ISSUE") || null;
  }

  const agentHarness = resolveAgentHarnessFromFlagsAndEnv({
    cursorFlag,
    claudeFlag,
    codexFlag,
    opencodeFlag,
  });

  return { awp, agentHarness, issueUrl, savedPlanName };
}

/**
 * Main entry point that orchestrates the two-phase workflow.
 *
 * Default mode (no --awp flag):
 * 1. Fetches or loads issue context
 * 2. Runs plan phase (read-only analysis)
 * 3. Runs implement phase (applies changes)
 * 4. Checks completion status of acceptance criteria
 * 5. If incomplete, prompts to name plan and generates continuation prompt
 * 6. Shows changes (user handles branches/commits/PRs)
 *
 * AWP mode (--awp flag):
 * 1. Fetches or loads issue context
 * 2. Prepares VCS state (prompts to use current bookmark/branch or create new one)
 * 3. Runs plan phase (read-only analysis)
 * 4. Runs implement phase (applies changes)
 * 5. Checks completion status and generates continuation prompt if incomplete
 * 6. Validates and commits changes
 * 7. Creates a draft PR
 *
 * Completion Detection:
 * - Automatically detects completion status from acceptance criteria checklists
 * - Generates continuation prompts for incomplete plans (saved as .continuation.plan.md)
 * - In normal mode, prompts to name incomplete plans before exit
 * - Continuation prompts can be used with Cursor or other agents to finish the work
 *
 * On failure, preserves debug files in a temp directory for inspection.
 */
async function main() {
  let awp: boolean;
  let agentHarness: AgentHarness;
  let issueUrl: string | null;
  let savedPlanName: string | null;
  try {
    ({ awp, agentHarness, issueUrl, savedPlanName } = parseArgs());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
  const saveCtx = Deno.env.get("SAVE_CTX") === "1";

  if (!issueUrl) {
    console.error(
      "Error: Either provide an issue URL as argument or set ISSUE environment variable",
    );
    console.error("\nUsage:");
    console.error("  # Default mode: Apply changes locally");
    console.error("  ./kickstart <issue_url>");
    console.error(
      "  ./kickstart --cursor <issue_url>  # Cursor headless agent instead of opencode",
    );
    console.error(
      "  ./kickstart --claude <issue_url>   # Claude Code CLI instead of opencode",
    );
    console.error(
      "  ./kickstart --codex <issue_url>    # Codex CLI instead of opencode",
    );
    console.error("\n  # AWP mode: Full workflow with branches and PR");
    console.error("  ./kickstart --awp <issue_url>");
    console.error("\n  # Plan management flags");
    console.error(
      "  ./kickstart --saved-plan <name> <issue_url>  # Use specific plan name",
    );
    console.error("\nEnvironment variables:");
    console.error(
      "  ISSUE                    GitHub issue URL (alternative to positional arg)",
    );
    console.error(
      "  CURSOR_ENABLED=1   # Cursor headless agent",
    );
    console.error(
      "  CLAUDE_ENABLED=1   # Claude Code (do not set both with CURSOR_ENABLED)",
    );
    console.error("  CODEX_ENABLED=1    # Codex CLI");
    console.error("  SAVE_CTX=1        # Preserve debug files on success");
    console.error("\nFeatures:");
    console.error(
      "  - Automatic completion detection from acceptance criteria",
    );
    console.error(
      "  - Continuation prompts for incomplete plans (.continuation.plan.md)",
    );
    console.error("  - Plan naming prompts in normal mode for incomplete work");
    Deno.exit(1);
  }

  const config: OrchestratorConfig = {
    awp,
    agentHarness,
    issueUrl,
    saveCtx,
    savedPlanName,
  };

  try {
    await runOrchestrator(config);
    // Force exit to prevent hanging on pending async operations
    Deno.exit(0);
  } catch (_error) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
