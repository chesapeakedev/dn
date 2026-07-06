// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  getCurrentSandboxContext,
  setCurrentSandboxContext,
} from "./context.ts";
import { runAgentPhaseInSandbox } from "./agentPhase.ts";
import type { ExecResult, SandboxHandle, SandboxRunner } from "./types.ts";

class StubRunner implements SandboxRunner {
  readonly provider = "docker" as const;
  lastExec:
    | { cmd: string[]; cwd?: string; env?: Record<string, string> }
    | null = null;

  provision(): Promise<SandboxHandle> {
    throw new Error("not used");
  }
  syncIn(): Promise<void> {
    return Promise.resolve();
  }
  syncOut(): Promise<void> {
    return Promise.resolve();
  }
  teardown(): Promise<void> {
    return Promise.resolve();
  }
  exec(
    _handle: SandboxHandle,
    cmd: string[],
    opts?: { cwd?: string; env?: Record<string, string> },
  ): Promise<ExecResult> {
    this.lastExec = { cmd, cwd: opts?.cwd, env: opts?.env };
    return Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
  }
}

Deno.test("runAgentPhaseInSandbox delegates to runner.exec when sandbox active", async () => {
  const runner = new StubRunner();
  const handle: SandboxHandle = {
    provider: "docker",
    id: "container-1",
    workspace: "/workspace",
  };
  setCurrentSandboxContext({
    runner,
    handle,
    provider: "docker",
    repoRoot: "/Users/me/repo",
  });
  try {
    const result = await runAgentPhaseInSandbox(
      "plan",
      "/Users/me/repo/.dn/tmp/combined_prompt_plan.txt",
      "/Users/me/repo",
      true,
      "opencode",
    );
    assertEquals(result.code, 0);
    assertEquals(runner.lastExec?.cmd, [
      "opencode",
      "run",
      "plan",
      "-f",
      "/workspace/.dn/tmp/combined_prompt_plan.txt",
      "--log-level=DEBUG",
    ]);
    assertEquals(runner.lastExec?.cwd, "/workspace");
    assertEquals(runner.lastExec?.env?.DN_SANDBOX_PROVIDER, "none");
    assertEquals(runner.lastExec?.env?.DN_IN_SANDBOX, "1");
  } finally {
    setCurrentSandboxContext(null);
  }
});

Deno.test("runAgentPhaseInSandbox clears context after lifecycle", () => {
  setCurrentSandboxContext(null);
  assertEquals(getCurrentSandboxContext(), null);
});
