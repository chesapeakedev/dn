// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "./agentHarness.ts";

const DN_PREFIX = "[dn] ";

/**
 * Formats the harness-agnostic phase-start intent line.
 *
 * @param harness - Selected agent backend
 * @param model - Resolved model id when known; omitted when unset
 * @returns Log line such as `[dn] agent=opencode model=deepinfra/zai-org/GLM-5.2`
 */
export function formatAgentPhaseIntentLog(
  harness: AgentHarness,
  model?: string | null,
): string {
  const trimmed = model?.trim();
  if (trimmed) {
    return `${DN_PREFIX}agent=${harness} model=${trimmed}`;
  }
  return `${DN_PREFIX}agent=${harness}`;
}

/**
 * Resolves the model dn intends to use for a harness phase, when known.
 *
 * - `opencode`: reads `model` from the phase config
 *   (`opencode.plan.json` / `opencode.implement.json`), falling back to
 *   `opencode.json`
 * - `copilot`: reads `COPILOT_MODEL` when set
 * - other harnesses: returns `undefined` (harness default)
 *
 * @param harness - Selected agent backend
 * @param workspaceRoot - Workspace containing OpenCode config files
 * @param useReadonlyConfig - When true, prefer plan-phase OpenCode config
 */
export async function resolveConfiguredAgentModel(
  harness: AgentHarness,
  workspaceRoot: string,
  useReadonlyConfig = false,
): Promise<string | undefined> {
  if (harness === "copilot") {
    const model = Deno.env.get("COPILOT_MODEL")?.trim();
    return model || undefined;
  }
  if (harness === "opencode") {
    return await readOpenCodeModel(workspaceRoot, useReadonlyConfig);
  }
  return undefined;
}

/**
 * Logs the resolved agent/model intent once at phase start.
 */
export async function logAgentPhaseIntent(
  harness: AgentHarness,
  workspaceRoot: string,
  useReadonlyConfig = false,
): Promise<void> {
  const model = await resolveConfiguredAgentModel(
    harness,
    workspaceRoot,
    useReadonlyConfig,
  );
  console.log(formatAgentPhaseIntentLog(harness, model));
}

async function readOpenCodeModel(
  workspaceRoot: string,
  useReadonlyConfig: boolean,
): Promise<string | undefined> {
  const candidates = useReadonlyConfig
    ? [
      `${workspaceRoot}/opencode.plan.json`,
      `${workspaceRoot}/opencode.json`,
    ]
    : [
      `${workspaceRoot}/opencode.implement.json`,
      `${workspaceRoot}/opencode.json`,
    ];
  for (const path of candidates) {
    const model = await readModelField(path);
    if (model) return model;
  }
  return undefined;
}

async function readModelField(path: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await Deno.readTextFile(path));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "model" in parsed &&
      typeof (parsed as { model: unknown }).model === "string"
    ) {
      const model = (parsed as { model: string }).model.trim();
      return model || undefined;
    }
  } catch {
    // Missing or invalid config is treated as unresolved.
  }
  return undefined;
}
