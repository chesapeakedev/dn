// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { createSandboxRunner } from "./factory.ts";
import { isSandboxDryRun } from "./resolve.ts";
import { assertSandboxPrerequisites } from "./validate.ts";
import { setCurrentSandboxContext } from "./context.ts";
import type { DnSandboxConfig, SandboxProvider } from "./types.ts";

/**
 * Provisions a sandbox, syncs workspace in, runs `fn`, syncs out, then tears down.
 *
 * Agent phase routing reads the sandbox context set here to decide whether to
 * delegate execution to `SandboxRunner.exec` or run on the host.
 */
export async function runWithSandboxLifecycle<T>(
  options: {
    repoRoot: string;
    config: DnSandboxConfig;
    provider: SandboxProvider;
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (options.provider === "none") {
    await setCurrentSandboxContext(null);
    return await fn();
  }

  await assertSandboxPrerequisites(options.provider);

  const dryRun = isSandboxDryRun();
  const runner = createSandboxRunner(options.provider);
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
    await runner.syncIn(handle);
    setCurrentSandboxContext({
      runner,
      handle,
      provider: options.provider,
      repoRoot: options.repoRoot,
    });
    return await fn();
  } finally {
    setCurrentSandboxContext(null);
    await runner.syncOut(handle);
    await runner.teardown(handle);
  }
}
