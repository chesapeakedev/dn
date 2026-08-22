// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname } from "@std/path";
import type { AgentHarness, AgentRunOptions } from "../github/agentHarness.ts";
import { getRunAgent } from "../github/agentHarness.ts";
import { buildClaudeExecArgs } from "../github/claudeAgent.ts";
import { buildCodexExecArgs } from "../github/codexAgent.ts";
import { buildCopilotExecArgs } from "../github/copilotAgent.ts";
import { buildCursorAgentArgs } from "../github/cursorAgent.ts";
import { logAgentPhaseIntent } from "../github/agentModel.ts";
import { buildOpenCodeRunArgs } from "../github/opencode.ts";
import {
  createProgressReporter,
  type ProgressReporter,
  streamAgentOutput,
} from "../github/progress.ts";
import { getCurrentSandboxContext, isSandboxActive } from "./context.ts";
import { translateHostPathToSandbox } from "./paths.ts";
import type { ExecResult } from "./types.ts";

let defaultReporter: ProgressReporter | undefined;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function getDefaultReporter(): ProgressReporter {
  defaultReporter ??= createProgressReporter();
  return defaultReporter;
}

function promptInstructionFor(combinedPromptPath: string): string {
  return `Read and execute the instructions in this file: ${combinedPromptPath}`;
}

function buildSandboxAgentCommand(
  harness: AgentHarness,
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  options?: AgentRunOptions,
): string[] {
  const promptInstruction = promptInstructionFor(combinedPromptPath);
  switch (harness) {
    case "opencode":
      return [
        "opencode",
        ...buildOpenCodeRunArgs(phase, combinedPromptPath, options),
      ];
    case "cursor":
      return ["agent", ...buildCursorAgentArgs(promptInstruction, options)];
    case "claude":
      return ["claude", ...buildClaudeExecArgs(promptInstruction, options)];
    case "codex":
      return [
        "codex",
        ...buildCodexExecArgs(workspaceRoot, promptInstruction, options),
      ];
    case "copilot":
      return [
        "copilot",
        ...buildCopilotExecArgs(promptInstruction, {
          allowedTools: Deno.env.get("COPILOT_ALLOWED_TOOLS"),
          model: options?.model?.trim() || Deno.env.get("COPILOT_MODEL"),
        }),
      ];
  }
}

export async function runAgentPhaseInSandbox(
  phase: "plan" | "implement",
  combinedPromptPath: string,
  workspaceRoot: string,
  useReadonlyConfig: boolean,
  harness: AgentHarness,
  reporter?: ProgressReporter,
  options?: AgentRunOptions,
): Promise<ExecResult> {
  const activeReporter = reporter ?? getDefaultReporter();
  if (!isSandboxActive()) {
    const runner = getRunAgent(harness, options);
    return await runner(
      phase,
      combinedPromptPath,
      workspaceRoot,
      useReadonlyConfig,
      activeReporter,
    );
  }

  const ctx = getCurrentSandboxContext()!;
  await logAgentPhaseIntent(
    harness,
    workspaceRoot,
    useReadonlyConfig,
    options,
  );
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
    sandboxCwd,
    options,
  );

  if (ctx.provider === "exe.dev") {
    await ctx.runner.syncIn(ctx.handle);
    const prompt = await Deno.readFile(combinedPromptPath);
    const encodedPrompt = prompt.toBase64();
    const uploadResult = await ctx.runner.exec(
      ctx.handle,
      [
        "sh",
        "-c",
        `mkdir -p ${shellQuote(dirname(sandboxPromptPath))} && ` +
        `printf %s ${shellQuote(encodedPrompt)} | base64 -d > ${
          shellQuote(sandboxPromptPath)
        }`,
      ],
      { cwd: sandboxWorkspace },
    );
    if (uploadResult.code !== 0) {
      throw new Error(
        `Failed to upload the agent prompt to exe.dev: ${
          uploadResult.stderr.trim() || uploadResult.stdout.trim()
        }`,
      );
    }
  }

  let result: ExecResult;
  try {
    result = await ctx.runner.exec(ctx.handle, argv, {
      cwd: sandboxCwd,
      env: execEnv,
    });
  } finally {
    if (ctx.provider === "exe.dev") {
      await ctx.runner.syncOut(ctx.handle);
    }
  }
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
