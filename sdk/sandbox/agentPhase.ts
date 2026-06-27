// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "../github/agentHarness.ts";
import { getRunAgent } from "../github/agentHarness.ts";
import { getCurrentSandboxContext, isSandboxActive } from "./context.ts";
import type { ExecResult } from "./types.ts";

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
): Promise<ExecResult> {
  if (!isSandboxActive()) {
    const runner = getRunAgent(harness);
    return await runner(
      phase,
      combinedPromptPath,
      workspaceRoot,
      useReadonlyConfig,
    );
  }

  const ctx = getCurrentSandboxContext()!;
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
    combinedPromptPath,
  );

  return await ctx.runner.exec(ctx.handle, argv, {
    cwd: workspaceRoot,
    env: execEnv,
  });
}
