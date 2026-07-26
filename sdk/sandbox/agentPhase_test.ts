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
  readonly calls: string[] = [];
  lastExec:
    | { cmd: string[]; cwd?: string; env?: Record<string, string> }
    | null = null;

  constructor(readonly provider: "docker" | "exe.dev" = "docker") {}

  provision(): Promise<SandboxHandle> {
    throw new Error("not used");
  }
  syncIn(): Promise<void> {
    this.calls.push("syncIn");
    return Promise.resolve();
  }
  syncOut(): Promise<void> {
    this.calls.push("syncOut");
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
    this.calls.push("exec");
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

Deno.test({
  name: "runAgentPhaseInSandbox checkpoints exe.dev around execution",
  permissions: { env: true, read: true, write: true },
}, async () => {
  const repoRoot = await Deno.makeTempDir();
  const promptPath = `${repoRoot}/.dn/tmp/combined_prompt_implement.txt`;
  await Deno.mkdir(`${repoRoot}/.dn/tmp`, { recursive: true });
  await Deno.writeTextFile(promptPath, "implement the plan");
  const runner = new StubRunner("exe.dev");
  const handle: SandboxHandle = {
    provider: "exe.dev",
    id: "vm-1",
    workspace: "/workspace",
  };
  setCurrentSandboxContext({
    runner,
    handle,
    provider: "exe.dev",
    repoRoot,
  });
  try {
    await runAgentPhaseInSandbox(
      "implement",
      promptPath,
      repoRoot,
      true,
      "codex",
    );
    assertEquals(runner.calls, ["syncIn", "exec", "exec", "syncOut"]);
  } finally {
    setCurrentSandboxContext(null);
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("runAgentPhaseInSandbox clears context after lifecycle", () => {
  setCurrentSandboxContext(null);
  assertEquals(getCurrentSandboxContext(), null);
});
