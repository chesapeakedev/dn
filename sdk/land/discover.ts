// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Resolves an explicit plan path or discovers one from PLAN env or plans/.
 *
 * @param explicitPath - User-provided plan path, if any
 * @returns Repository-relative path to the plan file
 */
export async function discoverPlanFile(
  explicitPath?: string,
): Promise<string> {
  if (explicitPath) {
    return explicitPath;
  }

  const fromEnv = Deno.env.get("PLAN");
  if (fromEnv) {
    return fromEnv;
  }

  const candidates: { path: string; mtime: number }[] = [];

  try {
    for await (const entry of Deno.readDir("plans")) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".plan.md")) continue;
      if (entry.name.includes(".test.")) continue;

      const path = `plans/${entry.name}`;
      const stat = await Deno.stat(path);
      candidates.push({
        path,
        mtime: stat.mtime?.getTime() ?? 0,
      });
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      "No plan file found. Pass a plan path, set PLAN, or add plans/*.plan.md.",
    );
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

/**
 * Resolves an optional test plan path from flag or naming convention.
 *
 * @param planFilePath - Primary plan file path
 * @param explicitTestPlan - User-provided test plan path, if any
 * @returns Test plan path when the file exists, otherwise undefined
 */
export async function discoverTestPlanFile(
  planFilePath: string,
  explicitTestPlan?: string,
): Promise<string | undefined> {
  const candidates: string[] = [];

  if (explicitTestPlan) {
    candidates.push(explicitTestPlan);
  }

  if (planFilePath.endsWith(".plan.md")) {
    candidates.push(
      planFilePath.replace(/\.plan\.md$/, ".test.plan.md"),
    );
  }

  for (const path of candidates) {
    try {
      await Deno.stat(path);
      return path;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  return undefined;
}
