// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn meld subcommand handler
 *
 * Merges multiple markdown sources (local paths and/or GitHub issue URLs) into DRY input
 * for the contextual planning workflow.
 */

import type { KickstartConfig } from "../kickstart/lib.ts";
import { runMeldPhase } from "../kickstart/lib.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import {
  deduplicateBlocks,
  ensureAcceptanceCriteriaSection,
  type MeldMode,
  mergeMarkdown,
  normalizeMarkdown,
  resolveSource,
} from "../sdk/mod.ts";

function meldModeToAgentHarness(mode: MeldMode): AgentHarness {
  if (mode === "cursor") {
    return "cursor";
  }
  if (mode === "claude") {
    return "claude";
  }
  return "opencode";
}

interface MeldArgs {
  sources: string[];
  outputPath: string | null;
  mode: MeldMode;
  agentHarness: AgentHarness;
  planName: string | null;
  workspaceRoot: string | undefined;
  target: string | null;
  overwrite: boolean;
  dryRun: boolean;
  autoYes: boolean;
  allowCrossRepo: boolean;
}

async function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null = null,
): Promise<MeldArgs> {
  let listPath: string | null = null;
  let outputPath: string | null = null;
  let mode: MeldMode = "opencode";
  let explicitAgent: AgentHarness | null = null;
  let agentOnlyFlag = false;
  let planName: string | null = null;
  let workspaceRoot: string | undefined = undefined;
  let target: string | null = null;
  let overwrite = false;
  let dryRun = false;
  let autoYes = false;
  let allowCrossRepo = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list" || arg === "-l") {
      if (i + 1 < args.length) {
        listPath = args[++i];
      }
    } else if (arg === "--output" || arg === "-o") {
      if (i + 1 < args.length) {
        outputPath = args[++i];
      }
    } else if (arg === "--plan-name") {
      if (i + 1 < args.length) {
        planName = args[++i];
      }
    } else if (arg === "--workspace-root" && i + 1 < args.length) {
      workspaceRoot = args[++i];
    } else if (arg === "--target" && i + 1 < args.length) {
      target = args[++i];
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      autoYes = true;
    } else if (arg === "--allow-cross-repo") {
      allowCrossRepo = true;
    } else if (arg === "--cursor" || arg === "-c") {
      mode = "cursor";
      explicitAgent = "cursor";
    } else if (arg === "--claude") {
      mode = "claude";
      explicitAgent = "claude";
    } else if (arg === "--opencode") {
      mode = "opencode";
      explicitAgent = "opencode";
    } else if (arg === "--codex") {
      explicitAgent = "codex";
      agentOnlyFlag = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }

  let sources = positionals;
  if (listPath !== null) {
    try {
      const listContent = await Deno.readTextFile(listPath);
      sources = listContent
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (e) {
      console.error(`Error reading list file ${listPath}:`, e);
      Deno.exit(1);
    }
  }

  if (globalAgent && agentOnlyFlag && explicitAgent !== globalAgent) {
    throw new Error(
      `Conflicting agent selections: --agent ${globalAgent} and --${explicitAgent}. Select only one agent.`,
    );
  }

  const agentHarness = globalAgent ?? explicitAgent ??
    meldModeToAgentHarness(mode);

  return {
    sources,
    outputPath,
    mode,
    agentHarness,
    planName,
    workspaceRoot,
    target,
    overwrite,
    dryRun,
    autoYes,
    allowCrossRepo,
  };
}

function showHelp(): void {
  console.log("dn meld - Merge markdown sources and run contextual planning\n");
  console.log("Usage:");
  console.log("  dn meld [options] <source> [source ...]");
  console.log("  dn meld --list <file> [options]\n");
  console.log(
    "Sources: local .md paths and/or GitHub issue URLs.",
  );
  console.log(
    "Merged markdown feeds the planner; `--target` selects where agent output lands.",
  );
  console.log("Options:");
  console.log("  --target <path-or-github> Output file or GitHub specifier");
  console.log(
    "    Supports README.md, AGENTS.md, CONTRIBUTING.md, plans/*.plan.md, other *.md paths,",
  );
  console.log(
    "    plus `github:issue:<ref>` or `github:comment:<ref>` for the checked-out repo.",
  );
  console.log(
    "  --overwrite             Replace targets instead of merge-style edits",
  );
  console.log(
    "  --dry-run               Resolve prompts/paths without invoking agents or GitHub mutations",
  );
  console.log(
    "  --yes, -y               Auto-approve prompts in unattended merges",
  );
  console.log("  --allow-cross-repo      Allow mismatched repos (prep parity)");
  console.log(
    "  --list, -l <path>       Newline-separated sources (POSIX style)",
  );
  console.log(
    "  --output, -o <path>     Write merged *input* markdown before planner runs",
  );
  console.log(
    "  --plan-name <name>      When targeting default plans (`plans/*.plan.md`), skip naming prompt",
  );
  console.log(
    "  --workspace-root <path> Workspace root (default cwd / WORKSPACE_ROOT)",
  );
  console.log(
    "  --cursor, -c            Cursor planner harness",
  );
  console.log("  --claude                  Claude planner harness");
  console.log(
    "  --codex                   Codex planner harness",
  );
  console.log(
    "  --opencode                Opencode planner harness (default)",
  );
  console.log("  --help, -h                Print help\n");
  console.log(
    "Merged context (`--output`/temp) is pre-agent markdown; `--target` is planner output.",
  );
  console.log("Examples:");
  console.log("  dn meld plan.md");
  console.log(
    "  dn meld findings.md ticket.md --target README.md --workspace-root .",
  );
  console.log(
    "  dn meld research.md --target github:comment:120 --overwrite --dry-run",
  );
  console.log("  dn meld -l sources.txt -o plans/merged.md --plan-name merged");
}

export async function handleMeld(
  args: string[],
  globalAgent: AgentHarness | null = null,
): Promise<void> {
  const {
    sources,
    outputPath,
    mode,
    agentHarness,
    planName,
    workspaceRoot,
    target,
    overwrite,
    dryRun,
    autoYes,
    allowCrossRepo,
  } = await parseArgs(args, globalAgent);

  if (sources.length === 0) {
    console.error(
      "Error: No sources provided. Use positionals or --list <file>.",
    );
    console.error("\nUse 'dn meld --help' for usage information.");
    Deno.exit(1);
  }

  try {
    const resolved: string[] = [];
    for (const src of sources) {
      try {
        const content = await resolveSource(src);
        resolved.push(content);
      } catch (e) {
        if (src.trim() === "") continue;
        console.error(`Error resolving ${src}:`, e);
        Deno.exit(1);
      }
    }

    const normalized = resolved.map((c) => normalizeMarkdown(c)).filter(
      Boolean,
    );
    if (normalized.length === 0) {
      console.error("Error: No content after resolving sources.");
      Deno.exit(1);
    }

    let merged = mergeMarkdown(normalized);
    merged = ensureAcceptanceCriteriaSection(merged, mode);
    merged = deduplicateBlocks(merged);

    const out = merged + "\n";
    const contextPath: string = outputPath !== null
      ? outputPath
      : await Deno.makeTempFile({
        prefix: "dn-meld-",
        suffix: ".md",
      });

    await Deno.writeTextFile(contextPath, out);

    const ks: KickstartConfig = {
      publish: "none" as const,
      agentHarness,
      allowCrossRepo,
      issueUrl: null,
      contextMarkdownPath: contextPath,
      saveCtx: false,
      savedPlanName: planName,
      workspaceRoot,
      meldPhase: {
        targetRaw: target,
        overwrite,
        dryRun,
        autoYes,
      },
    };

    const result = await runMeldPhase(ks);

    if (result.publishedUrl) {
      console.log(`\n${result.publishedUrl}`);
    } else {
      console.log(`\n${result.planFilePath}`);
    }
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
