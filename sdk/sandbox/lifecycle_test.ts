// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { runWithSandboxLifecycle } from "./lifecycle.ts";
import { DEFAULT_SANDBOX_CONFIG } from "./config.ts";
import type {
  ExecOptions,
  ExecResult,
  SandboxContext,
  SandboxHandle,
  SandboxRunner,
} from "./types.ts";

class RecordingRunner implements SandboxRunner {
  readonly provider = "docker" as const;
  readonly calls: string[] = [];

  provision(_ctx: SandboxContext): Promise<SandboxHandle> {
    this.calls.push("provision");
    return Promise.resolve({
      provider: "docker",
      id: "container",
      workspace: "/workspace",
    });
  }

  syncIn(_handle: SandboxHandle): Promise<void> {
    this.calls.push("syncIn");
    return Promise.resolve();
  }

  exec(
    _handle: SandboxHandle,
    _cmd: string[],
    _opts?: ExecOptions,
  ): Promise<ExecResult> {
    this.calls.push("exec");
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  }

  syncOut(_handle: SandboxHandle): Promise<void> {
    this.calls.push("syncOut");
    return Promise.reject(new Error("sync out failed"));
  }

  teardown(_handle: SandboxHandle): Promise<void> {
    this.calls.push("teardown");
    return Promise.resolve();
  }
}

Deno.test({
  name: "runWithSandboxLifecycle tears down when syncOut fails",
  permissions: { run: true, env: true },
}, async () => {
  const runner = new RecordingRunner();

  await assertRejects(
    () =>
      runWithSandboxLifecycle(
        {
          repoRoot: "/repo",
          config: { ...DEFAULT_SANDBOX_CONFIG, provider: "docker" },
          provider: "docker",
          runner,
        },
        () => Promise.resolve("done"),
      ),
    Error,
    "sync out failed",
  );

  assertEquals(runner.calls, ["provision", "syncIn", "syncOut", "teardown"]);
});
