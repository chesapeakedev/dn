// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "../github/agentHarness.ts";
import { getRunAgent } from "../github/agentHarness.ts";
import { formatAgentFailureOutput } from "../github/progress.ts";
import { detectVcs, getChangedFiles, showChanges } from "../github/vcs.ts";
import { deriveCommitMessage } from "../archive/derive.ts";
import { executeCommitPlan } from "./commit.ts";
import {
  extractLandJson,
  formatCommitPlanPreview,
  parseCommitPlan,
} from "./parse.ts";
import type { LandCommitPlan } from "./types.ts";

function getBinaryDir(): string {
  const url = new URL(import.meta.url);
  if (url.protocol === "file:") {
    return new URL(".", url).pathname;
  }
  return new URL(".", import.meta.url).pathname;
}

const BINARY_DIR = getBinaryDir();

async function readLandSystemPrompt(workspaceRoot: string): Promise<string> {
  const filename = "system.prompt.land.md";
  try {
    if (typeof import.meta.dirname !== "undefined") {
      try {
        return await Deno.readTextFile(
          import.meta.dirname + `/../../kickstart/${filename}`,
        );
      } catch {
        // fall through
      }
    }
  } catch {
    // fall through
  }

  try {
    return await Deno.readTextFile(`${BINARY_DIR}/${filename}`);
  } catch {
    // fall through
  }

  try {
    return await Deno.readTextFile(`${workspaceRoot}/kickstart/${filename}`);
  } catch {
    throw new Error(
      `Land system prompt not found: ${filename}. Run from dn repo or recompile with --include.`,
    );
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\.\/+/, "");
}

function excludePlanPaths(
  files: string[],
  planPaths: string[],
): string[] {
  const excluded = new Set(planPaths.map(normalizePath));
  return files
    .map(normalizePath)
    .filter((file) => !excluded.has(file));
}

async function removePlanFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await Deno.remove(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}

async function restorePlanFiles(
  snapshots: { path: string; content: string }[],
): Promise<void> {
  for (const { path, content } of snapshots) {
    try {
      await Deno.writeTextFile(path, content);
    } catch (restoreError) {
      console.error(`Warning: Could not restore plan file: ${path}`);
      console.error(
        restoreError instanceof Error
          ? restoreError.message
          : String(restoreError),
      );
    }
  }
}

export interface RunLandPhaseOptions {
  planFilePath: string;
  testPlanPath?: string;
  workspaceRoot: string;
  agentHarness: AgentHarness;
  dryRun: boolean;
}

/**
 * Runs the agent-driven land phase: propose logical commits and apply them.
 */
export async function runLandPhase(
  options: RunLandPhaseOptions,
): Promise<void> {
  const {
    planFilePath,
    testPlanPath,
    workspaceRoot,
    agentHarness,
    dryRun,
  } = options;

  const ctx = await detectVcs();
  if (!ctx) {
    throw new Error(
      "Not in a git or sapling repository. Run from a repo root.",
    );
  }

  const planContent = await Deno.readTextFile(planFilePath);
  const testPlanContent = testPlanPath
    ? await Deno.readTextFile(testPlanPath)
    : undefined;

  const { stat, diff } = await showChanges(ctx.vcs);
  const allChanged = await getChangedFiles(ctx.vcs);
  const planPaths = [planFilePath, testPlanPath].filter(
    (path): path is string => path !== undefined,
  );
  const landableFiles = excludePlanPaths(allChanged, planPaths);

  if (landableFiles.length === 0) {
    throw new Error(
      "No landable workspace changes found (plan files are excluded).",
    );
  }

  const messageSeed = deriveCommitMessage(planContent, planFilePath);
  const fakeOutput = Deno.env.get("DN_LAND_FAKE_OUTPUT");
  let plan: LandCommitPlan;

  if (fakeOutput !== undefined) {
    plan = parseCommitPlan(extractLandJson(fakeOutput), landableFiles);
  } else {
    const systemPrompt = await readLandSystemPrompt(workspaceRoot);
    const lines = [
      systemPrompt.trimEnd(),
      "",
      "---",
      "",
      "## Plan file",
      "",
      planContent,
    ];

    if (testPlanContent) {
      lines.push("", "## Test plan", "", testPlanContent);
    }

    lines.push(
      "",
      "## Changed files",
      "",
      landableFiles.map((f) => `- ${f}`).join("\n"),
      "",
      "## Diff stat",
      "",
      stat,
      "",
      "## Diff",
      "",
      diff,
      "",
      "## Single-commit message seed (hint only)",
      "",
      messageSeed.summary,
      messageSeed.body ?? "",
    );

    const tmpDir = await Deno.makeTempDir({ prefix: "dn-land-" });
    const promptPath = `${tmpDir}/land.prompt.md`;
    await Deno.writeTextFile(promptPath, lines.join("\n"));

    const run = getRunAgent(agentHarness);
    const result = await run(
      "plan",
      promptPath,
      workspaceRoot,
      true,
    );

    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});

    if (result.code !== 0) {
      throw new Error(
        `Land phase failed (exit ${result.code}): ${
          formatAgentFailureOutput(result.stderr || result.stdout)
        }`,
      );
    }

    plan = parseCommitPlan(extractLandJson(result.stdout), landableFiles);
  }

  const preview = formatCommitPlanPreview(plan);
  console.log(preview);

  if (dryRun) {
    return;
  }

  const snapshots = await Promise.all(
    planPaths.map(async (path) => ({
      path,
      content: await Deno.readTextFile(path),
    })),
  );

  let removedPlans = false;
  try {
    await removePlanFiles(planPaths);
    removedPlans = true;
    await executeCommitPlan(plan);
  } catch (error) {
    if (removedPlans) {
      await restorePlanFiles(snapshots);
    }
    throw error;
  }
}
