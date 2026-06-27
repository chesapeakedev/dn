// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { createDefaultCommandRunner } from "./prerequisites.ts";
import type { CommandRunner } from "./types.ts";
import type {
  ExecOptions,
  ExecResult,
  SandboxContext,
  SandboxHandle,
  SandboxRunner,
} from "./types.ts";

/** Runs commands on the host without isolation (default). */
export class HostRunner implements SandboxRunner {
  readonly provider = "none" as const;
  private readonly commandRunner: CommandRunner;

  constructor(commandRunner: CommandRunner = createDefaultCommandRunner()) {
    this.commandRunner = commandRunner;
  }

  provision(ctx: SandboxContext): Promise<SandboxHandle> {
    return Promise.resolve({
      provider: "none",
      id: "host",
      workspace: ctx.repoRoot,
    });
  }

  async exec(
    handle: SandboxHandle,
    cmd: string[],
    opts?: ExecOptions,
  ): Promise<ExecResult> {
    return await this.commandRunner.run(cmd, {
      cwd: opts?.cwd ?? handle.workspace,
      env: opts?.env,
    });
  }

  async syncIn(_handle: SandboxHandle): Promise<void> {
    // Host workspace is already canonical.
  }

  async syncOut(_handle: SandboxHandle): Promise<void> {
    // Host workspace is already canonical.
  }

  async teardown(_handle: SandboxHandle): Promise<void> {
    // No infrastructure to destroy.
  }
}
