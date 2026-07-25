// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, fromFileUrl, join } from "@std/path";

const WORKFLOW_DIRECTORY = "templates/workflows";
const MANIFEST_RELATIVE_PATH = `${WORKFLOW_DIRECTORY}/manifest.json`;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Whether to validate workflow checksums or update stale values. */
export type WorkflowChecksumMode = "check" | "write";

/** One workflow checksum that differs from its manifest value. */
export interface WorkflowChecksumMismatch {
  /** Stable workflow identifier from the manifest. */
  id: string;
  /** Repository-relative workflow template path. */
  sourcePath: string;
  /** Checksum currently recorded in the manifest. */
  actual: string;
  /** Checksum computed from the workflow template. */
  expected: string;
}

/** Result of checking or updating the workflow manifest. */
export interface WorkflowChecksumResult {
  /** Checksum differences found before any requested update. */
  mismatches: WorkflowChecksumMismatch[];
  /** Whether the manifest was rewritten. */
  written: boolean;
}

interface WorkflowManifestEntry {
  id: string;
  sourcePath: string;
  checksum: string;
}

interface ChecksumEdit {
  start: number;
  end: number;
  checksum: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseManifestEntries(manifestText: string): WorkflowManifestEntry[] {
  const parsed: unknown = JSON.parse(manifestText);
  if (!isRecord(parsed) || !Array.isArray(parsed.templates)) {
    throw new Error("Workflow manifest must contain a templates array");
  }

  const entries = parsed.templates.map((value, index) => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.source_path !== "string" ||
      typeof value.checksum !== "string"
    ) {
      throw new Error(
        `Workflow manifest template at index ${index} needs string id, source_path, and checksum fields`,
      );
    }
    if (!SHA256_PATTERN.test(value.checksum)) {
      throw new Error(
        `Workflow manifest template ${value.id} has an invalid sha256 checksum`,
      );
    }
    return {
      id: value.id,
      sourcePath: value.source_path,
      checksum: value.checksum,
    };
  });

  assertUnique(entries.map((entry) => entry.id), "workflow id");
  assertUnique(
    entries.map((entry) => entry.sourcePath),
    "workflow source_path",
  );
  return entries;
}

function assertUnique(values: string[], description: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${description}: ${value}`);
    }
    seen.add(value);
  }
}

async function listWorkflowSourcePaths(repoRoot: string): Promise<string[]> {
  const workflowRoot = join(repoRoot, WORKFLOW_DIRECTORY);
  const sourcePaths: string[] = [];
  for await (const entry of Deno.readDir(workflowRoot)) {
    if (entry.isFile && entry.name.endsWith(".yml")) {
      sourcePaths.push(`${WORKFLOW_DIRECTORY}/${entry.name}`);
    }
  }
  return sourcePaths.sort();
}

function validateManifestCoverage(
  entries: WorkflowManifestEntry[],
  sourcePaths: string[],
): void {
  const manifestPaths = new Set(entries.map((entry) => entry.sourcePath));
  const diskPaths = new Set(sourcePaths);
  const unlisted = sourcePaths.filter((sourcePath) =>
    !manifestPaths.has(sourcePath)
  );
  const missing = entries
    .map((entry) => entry.sourcePath)
    .filter((sourcePath) => !diskPaths.has(sourcePath));

  const problems: string[] = [];
  if (unlisted.length > 0) {
    problems.push(`unlisted templates: ${unlisted.join(", ")}`);
  }
  if (missing.length > 0) {
    problems.push(`missing templates: ${missing.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Workflow manifest coverage is invalid: ${problems.join("; ")}`,
    );
  }
}

async function validateCompiledWorkflowCoverage(
  repoRoot: string,
  sourcePaths: string[],
): Promise<void> {
  const compileScript = await Deno.readTextFile(
    join(repoRoot, "compile_dn.sh"),
  );
  const includePattern =
    /--include "\$\{WORKFLOW_TEMPLATE_DIR\}\/([^"]+\.yml)"/g;
  const includedPaths = Array.from(compileScript.matchAll(includePattern))
    .map((match) => `${WORKFLOW_DIRECTORY}/${match[1]}`)
    .sort();
  assertUnique(includedPaths, "compiled workflow include");

  const expectedPaths = new Set(sourcePaths);
  const actualPaths = new Set(includedPaths);
  const omitted = sourcePaths.filter((sourcePath) =>
    !actualPaths.has(sourcePath)
  );
  const extra = includedPaths.filter((sourcePath) =>
    !expectedPaths.has(sourcePath)
  );

  const problems: string[] = [];
  if (omitted.length > 0) {
    problems.push(`omitted templates: ${omitted.join(", ")}`);
  }
  if (extra.length > 0) {
    problems.push(`unmanifested templates: ${extra.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Compiled workflow coverage is invalid: ${problems.join("; ")}`,
    );
  }
}

async function computeSha256(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function findChecksumEdit(
  manifestText: string,
  entry: WorkflowManifestEntry,
): ChecksumEdit {
  const sourceMarker = `"source_path": ${JSON.stringify(entry.sourcePath)}`;
  const sourceStart = manifestText.indexOf(sourceMarker);
  if (
    sourceStart === -1 ||
    manifestText.indexOf(sourceMarker, sourceStart + 1) !== -1
  ) {
    throw new Error(
      `Expected one formatted source_path field for ${entry.sourcePath}`,
    );
  }

  const nextSourceStart = manifestText.indexOf(
    '"source_path"',
    sourceStart + 1,
  );
  const blockEnd = nextSourceStart === -1
    ? manifestText.length
    : nextSourceStart;
  const block = manifestText.slice(sourceStart, blockEnd);
  const checksumPattern = /"checksum"\s*:\s*"(sha256:[0-9a-f]{64})"/g;
  const matches = Array.from(block.matchAll(checksumPattern));
  if (matches.length !== 1 || matches[0].index === undefined) {
    throw new Error(
      `Expected one formatted checksum field after ${entry.sourcePath}`,
    );
  }

  const match = matches[0];
  const checksumOffset = match[0].indexOf(match[1]);
  if (checksumOffset === -1 || match[1] !== entry.checksum) {
    throw new Error(`Could not locate the checksum for ${entry.sourcePath}`);
  }
  const start = sourceStart + match.index + checksumOffset;
  return {
    start,
    end: start + entry.checksum.length,
    checksum: entry.checksum,
  };
}

function applyChecksumEdits(
  manifestText: string,
  edits: ChecksumEdit[],
): string {
  let updated = manifestText;
  for (
    const edit of edits.toSorted((left, right) => right.start - left.start)
  ) {
    updated = updated.slice(0, edit.start) +
      edit.checksum +
      updated.slice(edit.end);
  }
  return updated;
}

/**
 * Validate workflow manifest coverage and synchronize template checksums.
 *
 * In `check` mode this function never writes. In `write` mode it updates only
 * stale checksum values and preserves all other manifest formatting.
 */
export async function synchronizeWorkflowChecksums(
  repoRoot: string,
  mode: WorkflowChecksumMode,
): Promise<WorkflowChecksumResult> {
  const manifestPath = join(repoRoot, MANIFEST_RELATIVE_PATH);
  const manifestText = await Deno.readTextFile(manifestPath);
  const entries = parseManifestEntries(manifestText);
  const sourcePaths = await listWorkflowSourcePaths(repoRoot);
  validateManifestCoverage(entries, sourcePaths);
  await validateCompiledWorkflowCoverage(repoRoot, sourcePaths);

  const mismatches: WorkflowChecksumMismatch[] = [];
  const edits: ChecksumEdit[] = [];
  for (const entry of entries) {
    const content = await Deno.readTextFile(join(repoRoot, entry.sourcePath));
    const expected = await computeSha256(content);
    if (expected === entry.checksum) {
      continue;
    }
    mismatches.push({
      id: entry.id,
      sourcePath: entry.sourcePath,
      actual: entry.checksum,
      expected,
    });
    edits.push({
      ...findChecksumEdit(manifestText, entry),
      checksum: expected,
    });
  }

  if (mode === "write" && edits.length > 0) {
    await Deno.writeTextFile(
      manifestPath,
      applyChecksumEdits(manifestText, edits),
    );
  }
  return { mismatches, written: mode === "write" && edits.length > 0 };
}

function parseMode(args: string[]): WorkflowChecksumMode {
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) {
    return "check";
  }
  if (args.length === 1 && args[0] === "--write") {
    return "write";
  }
  throw new Error("Usage: deno task workflows:checksums [--check|--write]");
}

async function main(args: string[]): Promise<void> {
  const mode = parseMode(args);
  const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
  const result = await synchronizeWorkflowChecksums(repoRoot, mode);

  if (result.mismatches.length === 0) {
    console.log("Workflow manifest checksums are current.");
    return;
  }
  if (result.written) {
    console.log(
      `Updated ${result.mismatches.length} workflow manifest checksum(s).`,
    );
    return;
  }

  console.error("Workflow manifest checksums are stale:");
  for (const mismatch of result.mismatches) {
    console.error(
      `  ${mismatch.id}: ${mismatch.actual} -> ${mismatch.expected}`,
    );
  }
  console.error("Run `deno task workflows:checksums --write` to update them.");
  Deno.exitCode = 1;
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Workflow checksum validation failed: ${message}`);
    Deno.exitCode = 1;
  }
}
