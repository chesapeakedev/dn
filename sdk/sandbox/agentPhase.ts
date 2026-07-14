// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "../github/agentHarness.ts";
import { getRunAgent } from "../github/agentHarness.ts";
import {
  createProgressReporter,
  type ProgressReporter,
  streamAgentOutput,
} from "../github/progress.ts";
import { getCurrentSandboxContext, isSandboxActive } from "./context.ts";
import { translateHostPathToSandbox } from "./paths.ts";
import type { ExecResult } from "./types.ts";

let defaultReporter: ProgressReporter | undefined;

function getDefaultReporter(): ProgressReporter {
  defaultReporter ??= createProgressReporter();
  return defaultReporter;
}

function buildSandboxAgentCommand(
  harness: AgentHarness,
  phase: "plan" | "implement",
  combinedPromptPath: string,
): string[] {
  switch (harness) {
    case "opencode":
      return [
        "opencode",
        "run",
        phase,
        "-f",
        combinedPromptPath,
        "--log-level=DEBUG",
      ];
    case "cursor":
      return [
        "agent",
        "-p",
        "--force",
        `Read and execute the instructions in this file: ${combinedPromptPath}`,
      ];
    case "claude":
      return ["claude", "-p", "-f", combinedPromptPath];
    case "codex":
      return ["codex", "exec", "-f", combinedPromptPath];
    case "copilot":
      return ["copilot", "-p", combinedPromptPath];
  }
}

export async function runAgentPhaseInSandbox(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  useReadonlyConfig: boolean,
  harness: AgentHarness,
  reporter?: ProgressReporter,
): Promise<ExecResult> {
  const activeReporter = reporter ?? getDefaultReporter();
  if (!isSandboxActive()) {
    const runner = getRunAgent(harness);
    return await runner(
      phase,
      combinedPromptPath,
      workspaceRoot,
      useReadonlyConfig,
      activeReporter,
    );
  }

  const ctx = getCurrentSandboxContext()!;
  const sandboxWorkspace = ctx.handle.workspace;
  const sandboxPromptPath = translateHostPathToSandbox(
    combinedPromptPath,
    ctx.repoRoot,
    sandboxWorkspace,
  );
  const sandboxCwd = translateHostPathToSandbox(
    workspaceRoot,
    ctx.repoRoot,
    sandboxWorkspace,
  );

  const execEnv: Record<string, string> = {
    DN_SANDBOX_PROVIDER: "none",
    DN_IN_SANDBOX: "1",
  };

  const timeoutMs = Deno.env.get("OPENCODE_TIMEOUT_MS");
  if (timeoutMs) {
    execEnv.OPENCODE_TIMEOUT_MS = timeoutMs;
  }

  const argv = buildSandboxAgentCommand(
    harness,
    phase,
    sandboxPromptPath,
  );

  const result = await ctx.runner.exec(ctx.handle, argv, {
    cwd: sandboxCwd,
    env: execEnv,
  });
  await Promise.all([
    streamAgentOutput(new Blob([result.stdout]).stream(), activeReporter, {
      phase,
      stream: "stdout",
    }),
    streamAgentOutput(new Blob([result.stderr]).stream(), activeReporter, {
      phase,
      stream: "stderr",
    }),
  ]);
  return result;
}

/** Resolves host cwd to sandbox cwd for lint and other exec calls. */
export function translateSandboxCwd(
  hostCwd: string,
): string {
  const ctx = getCurrentSandboxContext();
  if (!ctx) {
    return hostCwd;
  }
  return translateHostPathToSandbox(
    hostCwd,
    ctx.repoRoot,
    ctx.handle.workspace,
  );
}
