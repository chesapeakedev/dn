// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn meld subcommand handler
 *
 * Merges multiple markdown sources (local files and/or GitHub issue URLs)
 * into a single DRY document with an Acceptance Criteria section.
 */

import { runPlanPhase } from "../kickstart/lib.ts";
import {
  deduplicateBlocks,
  ensureAcceptanceCriteriaSection,
  type MeldMode,
  mergeMarkdown,
  normalizeMarkdown,
  resolveSource,
} from "../sdk/mod.ts";

interface MeldArgs {
  sources: string[];
  outputPath: string | null;
  mode: MeldMode;
  planName: string | null;
  workspaceRoot: string | undefined;
}

async function parseArgs(args: string[]): Promise<MeldArgs> {
  let listPath: string | null = null;
  let outputPath: string | null = null;
  let mode: MeldMode = "opencode";
  let planName: string | null = null;
  let workspaceRoot: string | undefined = undefined;
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
    } else if (arg === "--cursor" || arg === "-c") {
      mode = "cursor";
    } else if (arg === "--opencode") {
      mode = "opencode";
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

  return { sources, outputPath, mode, planName, workspaceRoot };
}

function showHelp(): void {
  console.log("dn meld - Merge markdown sources and run plan phase\n");
  console.log("Usage:");
  console.log("  dn meld [options] <source> [source ...]");
  console.log("  dn meld --list <file> [options]\n");
  console.log(
    "Sources: one or more local .md paths and/or GitHub issue URLs.",
  );
  console.log("Merged content is used as context for the plan phase (prep).");
  console.log("Options:");
  console.log("  --list, -l <path>    Newline-separated list of sources");
  console.log(
    "  --output, -o <path>   Write merged markdown to file (also used as context)",
  );
  console.log(
    "  --plan-name <name>    Plan name for output (avoids prompt when non-interactive)",
  );
  console.log(
    "  --workspace-root <path>  Workspace root (default: cwd)",
  );
  console.log(
    "  --cursor, -c          Cursor mode: add YAML frontmatter; use Cursor agent for plan phase",
  );
  console.log(
    "  --opencode            Opencode mode (default): no frontmatter",
  );
  console.log("  --help, -h            Show this help\n");
  console.log("Examples:");
  console.log("  dn meld plan.md");
  console.log("  dn meld https://github.com/owner/repo/issues/123");
  console.log("  dn meld a.md b.md");
  console.log("  dn meld -l sources.txt -o plans/merged.md --plan-name merged");
  console.log(
    "  dn meld a.md https://github.com/owner/repo/issues/123 --cursor",
  );
}

export async function handleMeld(args: string[]): Promise<void> {
  const { sources, outputPath, mode, planName, workspaceRoot } =
    await parseArgs(args);

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

    const result = await runPlanPhase({
      awp: false,
      cursorEnabled: mode === "cursor",
      issueUrl: null,
      contextMarkdownPath: contextPath,
      saveCtx: false,
      savedPlanName: planName,
      workspaceRoot,
    });

    console.log(`\n${result.planFilePath}`);
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
