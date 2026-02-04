// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn meld subcommand handler
 *
 * Merges multiple markdown sources (local files and/or GitHub issue URLs)
 * into a single DRY document with an Acceptance Criteria section.
 */

import {
  deduplicateBlocks,
  ensureAcceptanceCriteriaSection,
  mergeMarkdown,
  normalizeMarkdown,
  resolveSource,
} from "../sdk/meld/mod.ts";
import type { MeldMode } from "../sdk/meld/mod.ts";

interface MeldArgs {
  sources: string[];
  outputPath: string | null;
  mode: MeldMode;
}

async function parseArgs(args: string[]): Promise<MeldArgs> {
  let listPath: string | null = null;
  let outputPath: string | null = null;
  let mode: MeldMode = "opencode";
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

  return { sources, outputPath, mode };
}

function showHelp(): void {
  console.log("dn meld - Merge and trim markdown sources\n");
  console.log("Usage:");
  console.log("  dn meld [options] <source> [source ...]");
  console.log("  dn meld --list <file> [options]\n");
  console.log("Sources: local .md paths and/or GitHub issue URLs.");
  console.log("Options:");
  console.log("  --list, -l <path>    Newline-separated list of sources");
  console.log(
    "  --output, -o <path>   Write merged markdown to file (default: stdout)",
  );
  console.log(
    "  --cursor, -c          Cursor mode: add YAML frontmatter (name, overview, todos, isProject)",
  );
  console.log(
    "  --opencode            Opencode mode (default): no frontmatter",
  );
  console.log("  --help, -h            Show this help\n");
  console.log("Examples:");
  console.log("  dn meld a.md b.md");
  console.log("  dn meld -l sources.txt -o plans/merged.plan.md");
  console.log(
    "  dn meld a.md https://github.com/owner/repo/issues/123 --cursor",
  );
}

export async function handleMeld(args: string[]): Promise<void> {
  const { sources, outputPath, mode } = await parseArgs(args);

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
    if (outputPath !== null) {
      await Deno.writeTextFile(outputPath, out);
    } else {
      console.log(out);
    }
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
