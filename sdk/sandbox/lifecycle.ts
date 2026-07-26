// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { createSandboxRunner } from "./factory.ts";
import { isSandboxDryRun } from "./resolve.ts";
import { assertSandboxPrerequisites } from "./validate.ts";
import { setCurrentSandboxContext } from "./context.ts";
import type {
  DnSandboxConfig,
  SandboxProvider,
  SandboxRunner,
} from "./types.ts";

/**
 * Provisions a sandbox, runs `fn`, then tears down.
 *
 * Bind-mounted providers synchronize at lifecycle boundaries. Git-clone
 * providers synchronize around each agent phase so host orchestration can
 * validate and publish remote edits before the lifecycle ends.
 *
 * Agent phase routing reads the sandbox context set here to decide whether to
 * delegate execution to `SandboxRunner.exec` or run on the host.
 */
export async function runWithSandboxLifecycle<T>(
  options: {
    repoRoot: string;
    config: DnSandboxConfig;
    provider: SandboxProvider;
    /** Test hook for exercising lifecycle ordering without real infrastructure. */
    runner?: SandboxRunner;
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (options.provider === "none") {
    await setCurrentSandboxContext(null);
    return await fn();
  }

  if (!options.runner) {
    await assertSandboxPrerequisites(options.provider);
  }

  const dryRun = isSandboxDryRun();
  const runner = options.runner ?? createSandboxRunner(options.provider);
  const ctx = {
    repoRoot: options.repoRoot,
    config: options.config,
    dryRun,
  };

  const handle = await runner.provision(ctx);
  console.log(
    `Sandbox provider "${options.provider}" provisioned (phase 2: agent harness runs inside sandbox).`,
  );

  try {
    if (options.provider !== "exe.dev") {
      await runner.syncIn(handle);
    }
    setCurrentSandboxContext({
      runner,
      handle,
      provider: options.provider,
      repoRoot: options.repoRoot,
    });
    return await fn();
  } finally {
    setCurrentSandboxContext(null);
    try {
      if (options.provider !== "exe.dev") {
        await runner.syncOut(handle);
      }
    } finally {
      await runner.teardown(handle);
    }
  }
}
