// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * `dn rfc` — CRUD for in-repo design RFCs under `rfcs/` (or `dn.json` `rfc.dir`).
 */

import { join } from "@std/path";
import { completeRfc } from "../sdk/rfc/complete.ts";
import {
  generateRfcFilename,
  isRfcStatus,
  isValidStatusTransition,
  type RfcMetadata,
  type RfcStatus,
} from "../sdk/rfc/types.ts";
import {
  createRfcContent,
  readRfc,
  updateRfcContent,
} from "../sdk/rfc/parser.ts";
import {
  findRfc,
  getRfcDir,
  getStatePath,
  listRfcsFromState,
  loadState,
  readConfig,
  type RfcRepoOptions,
  saveState,
  updateRfcInState,
} from "../sdk/rfc/state.ts";
import { formatInfo, formatSuccess } from "./output.ts";

function repoOptions(): RfcRepoOptions {
  return { repoRoot: Deno.cwd() };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function handleInit(_args: string[]): Promise<void> {
  const options = repoOptions();
  const dir = await getRfcDir(options);
  const statePath = await getStatePath(options);
  const overviewPath = join(dir, "000-overview.md");

  await Deno.mkdir(dir, { recursive: true });

  const stateExisted = await pathExists(statePath);
  if (!stateExisted) {
    await saveState({ nextId: 1, rfcs: {} }, options);
  }

  if (!await pathExists(overviewPath)) {
    const overviewContent = `---
id: 0
title: "RFC Overview"
status: draft
---

# RFC Overview

This directory contains RFCs (Request for Comments) for design decisions.

## Statuses

\`draft\` → \`review\` → \`accepted\` → \`implementing\` → \`done\` (or \`superseded\`)

## Commands

\`\`\`bash
dn rfc create --title "Descriptive Title"
dn rfc list
dn rfc show 1
dn rfc status 1 review
dn rfc complete 1
\`\`\`
`;
    await Deno.writeTextFile(overviewPath, overviewContent);
  }

  if (stateExisted) {
    console.log(formatInfo(`RFC system already initialized in ${dir}/`));
  } else {
    console.log(formatSuccess(`RFC system initialized in ${dir}/`));
  }
  console.log(formatInfo(`Overview: ${overviewPath}`));
  console.log(formatInfo(`State: ${statePath}`));
}

async function handleCreate(args: string[]): Promise<void> {
  let title: string | null = null;
  let slug: string | null = null;
  let githubIssue: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--title" && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === "--slug" && i + 1 < args.length) {
      slug = args[++i];
    } else if (arg === "--github-issue" && i + 1 < args.length) {
      githubIssue = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      showCreateHelp();
      return;
    } else if (!arg.startsWith("-") && !title) {
      title = arg;
    }
  }

  if (!title) {
    console.error("Error: Title is required");
    console.error(
      '\nUsage: dn rfc create --title "Title" [--slug custom-slug] [--github-issue URL]',
    );
    Deno.exit(1);
  }

  const options = repoOptions();
  const dir = await getRfcDir(options);
  await Deno.mkdir(dir, { recursive: true });

  const state = await loadState(options);
  const id = state.nextId;
  const filename = generateRfcFilename(id, slug ?? title);
  const filepath = join(dir, filename);

  if (await pathExists(filepath)) {
    console.error(`Error: RFC file already exists: ${filepath}`);
    Deno.exit(1);
  }

  const metadata: RfcMetadata = {
    id,
    title,
    status: "draft",
    ...(githubIssue ? { githubIssue } : {}),
  };
  const content = createRfcContent(
    metadata,
    `# ${title}\n\nWrite your RFC here.\n`,
  );
  await Deno.writeTextFile(filepath, content);

  // Store repo-relative paths in state for portability.
  const { dir: relDir } = await readConfig(options);
  const relativePath = join(relDir, filename);
  const rfc = await readRfc(filepath);
  rfc.path = relativePath;
  await updateRfcInState(rfc, options);

  console.log(formatSuccess(`Created RFC ${id}: ${title}`));
  console.log(formatInfo(`Path: ${relativePath}`));
  console.log(formatInfo(`Status: draft`));
}

async function handleList(args: string[]): Promise<void> {
  let statusFilter: RfcStatus | null = null;
  let outputJson = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--status" && i + 1 < args.length) {
      const value = args[++i];
      if (!isRfcStatus(value)) {
        console.error(
          `Error: Invalid status "${value}". Must be one of: draft, review, accepted, implementing, done, superseded`,
        );
        Deno.exit(1);
      }
      statusFilter = value;
    } else if (arg === "--json") {
      outputJson = true;
    } else if (arg === "--help" || arg === "-h") {
      showListHelp();
      return;
    }
  }

  const rfcs = await listRfcsFromState(repoOptions());
  const filtered = statusFilter
    ? rfcs.filter((rfc) => rfc.metadata.status === statusFilter)
    : rfcs;

  if (outputJson) {
    console.log(JSON.stringify(
      filtered.map((rfc) => ({
        id: rfc.metadata.id,
        title: rfc.metadata.title,
        status: rfc.metadata.status,
        githubIssue: rfc.metadata.githubIssue,
        path: rfc.path,
      })),
      null,
      2,
    ));
    return;
  }

  if (filtered.length === 0) {
    console.log(
      "No RFCs found" + (statusFilter ? ` with status "${statusFilter}"` : ""),
    );
    return;
  }

  console.log("RFCs:");
  for (const rfc of filtered) {
    const idStr = rfc.metadata.id.toString().padStart(3, "0");
    console.log(`  ${idStr} [${rfc.metadata.status}] ${rfc.metadata.title}`);
    if (rfc.metadata.githubIssue) {
      console.log(`      ${rfc.metadata.githubIssue}`);
    }
  }
}

function resolveRfcPath(storedPath: string): string {
  if (storedPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(storedPath)) {
    return storedPath;
  }
  return join(Deno.cwd(), storedPath);
}

async function handleShow(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    if (args.length === 0) {
      console.error("Error: RFC reference required");
      console.error("\nUsage: dn rfc show <id|slug|path>");
      Deno.exit(1);
    }
    console.log("dn rfc show - Show RFC contents");
    console.log("\nUsage: dn rfc show <id|slug|path>");
    return;
  }

  const rfc = await findRfc(args[0], repoOptions());
  if (!rfc) {
    console.error(`Error: RFC not found: ${args[0]}`);
    Deno.exit(1);
  }
  console.log(await Deno.readTextFile(resolveRfcPath(rfc.path)));
}

async function handleStatus(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error("Error: RFC reference and status required");
    console.error("\nUsage: dn rfc status <id|slug|path> <status>");
    console.error(
      "\nValid statuses: draft, review, accepted, implementing, done, superseded",
    );
    Deno.exit(1);
  }

  const ref = args[0];
  const newStatus = args[1];
  if (!isRfcStatus(newStatus)) {
    console.error(
      `Error: Invalid status "${newStatus}". Must be one of: draft, review, accepted, implementing, done, superseded`,
    );
    Deno.exit(1);
  }

  const options = repoOptions();
  const rfc = await findRfc(ref, options);
  if (!rfc) {
    console.error(`Error: RFC not found: ${ref}`);
    Deno.exit(1);
  }

  if (!isValidStatusTransition(rfc.metadata.status, newStatus)) {
    console.error(
      `Error: Cannot transition from "${rfc.metadata.status}" to "${newStatus}"`,
    );
    Deno.exit(1);
  }

  const absolutePath = resolveRfcPath(rfc.path);
  const content = await Deno.readTextFile(absolutePath);
  const newMetadata: RfcMetadata = { ...rfc.metadata, status: newStatus };
  await Deno.writeTextFile(
    absolutePath,
    updateRfcContent(content, newMetadata),
  );

  const updated = await readRfc(absolutePath);
  updated.path = rfc.path;
  await updateRfcInState(updated, options);

  console.log(
    formatSuccess(`Updated RFC ${rfc.metadata.id} status to ${newStatus}`),
  );
}

async function handleComplete(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error("Error: RFC reference required");
    console.error("\nUsage: dn rfc complete <id|slug|path>");
    Deno.exit(1);
  }
  const ref = args[0];
  const options = repoOptions();
  const before = await findRfc(ref, options);
  const result = await completeRfc(ref, options);
  if (before) {
    const path = resolveRfcPath(before.path);
    if (!await pathExists(path)) {
      console.error(
        `Error: RFC file missing after complete (should never delete): ${path}`,
      );
      Deno.exit(1);
    }
    console.log(
      formatSuccess(
        `Updated RFC ${result.rfc.metadata.id} status to done`,
      ),
    );
    console.log(formatInfo(`File retained: ${before.path}`));
  } else {
    console.log(
      formatSuccess(
        `Updated RFC ${result.rfc.metadata.id} status to done`,
      ),
    );
    console.log(formatInfo(`File retained: ${result.rfc.path}`));
  }
}

function showCreateHelp(): void {
  console.log("dn rfc create - Create a new RFC");
  console.log(
    '\nUsage: dn rfc create --title "Title" [--slug custom-slug] [--github-issue URL]',
  );
  console.log("\nArguments:");
  console.log("  --title TITLE       RFC title (required)");
  console.log(
    "  --slug SLUG         Custom slug for filename (default: from title)",
  );
  console.log("  --github-issue URL  Link to GitHub issue");
  console.log("  -h, --help          Show this help");
}

function showListHelp(): void {
  console.log("dn rfc list - List RFCs");
  console.log("\nUsage: dn rfc list [--status STATUS] [--json]");
  console.log("\nArguments:");
  console.log(
    "  --status STATUS    Filter by status (draft, review, accepted, implementing, done, superseded)",
  );
  console.log("  --json             Output as JSON");
  console.log("  -h, --help         Show this help");
}

function showHelp(): void {
  console.log("dn rfc - Manage RFCs (Request for Comments)");
  console.log("\nUsage: dn rfc <command> [options]");
  console.log("\nCommands:");
  console.log("  init      Initialize RFC directory and overview");
  console.log("  create    Create a new RFC");
  console.log("  list      List RFCs");
  console.log("  show      Show RFC contents");
  console.log("  status    Update RFC status");
  console.log("  complete  Mark RFC as done (does not delete the file)");
  console.log("\nUse 'dn rfc <command> --help' for command-specific help");
}

/**
 * Handles `dn rfc` and its subcommands.
 */
export async function handleRfc(args: string[]): Promise<void> {
  if (args.length === 0) {
    showHelp();
    return;
  }

  const subcommand = args[0];
  const subcommandArgs = args.slice(1);

  switch (subcommand) {
    case "init":
      await handleInit(subcommandArgs);
      break;
    case "create":
      await handleCreate(subcommandArgs);
      break;
    case "list":
      await handleList(subcommandArgs);
      break;
    case "show":
      await handleShow(subcommandArgs);
      break;
    case "status":
      await handleStatus(subcommandArgs);
      break;
    case "complete":
      await handleComplete(subcommandArgs);
      break;
    case "--help":
    case "-h":
    case "help":
      showHelp();
      break;
    default:
      console.error(`Unknown rfc subcommand: ${subcommand}`);
      showHelp();
      Deno.exit(1);
  }
}
