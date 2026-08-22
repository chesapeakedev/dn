// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness, AgentRunOptions } from "./agentHarness.ts";
import { formatDetail } from "./output.ts";

/**
 * Formats the harness-agnostic phase-start intent line.
 *
 * @param harness - Selected agent backend
 * @param model - Resolved model id when known; omitted when unset
 * @param thinking - Explicit thinking/effort/variant when provided
 * @returns Detail line such as `agent=opencode model=…` (branded when mixed logs)
 */
export function formatAgentPhaseIntentLog(
  harness: AgentHarness,
  model?: string | null,
  thinking?: string | null,
): string {
  const trimmedModel = model?.trim();
  const trimmedThinking = thinking?.trim();
  const parts = [`agent=${harness}`];
  if (trimmedModel) {
    parts.push(`model=${trimmedModel}`);
  }
  if (trimmedThinking) {
    parts.push(`thinking=${trimmedThinking}`);
  }
  return formatDetail(parts.join(" "));
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
 *
 * CLI `--agent` model and thinking override configured defaults.
 */
export async function logAgentPhaseIntent(
  harness: AgentHarness,
  workspaceRoot: string,
  useReadonlyConfig = false,
  options?: AgentRunOptions,
): Promise<void> {
  const configured = await resolveConfiguredAgentModel(
    harness,
    workspaceRoot,
    useReadonlyConfig,
  );
  const model = options?.model?.trim() || configured;
  console.log(formatAgentPhaseIntentLog(harness, model, options?.thinking));
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
