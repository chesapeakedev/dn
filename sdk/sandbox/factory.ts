// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { DockerRunner } from "./dockerRunner.ts";
import { ExeDevRunner } from "./exeDevRunner.ts";
import { HostRunner } from "./hostRunner.ts";
import type { SandboxProvider, SandboxRunner } from "./types.ts";
import type { CommandRunner } from "./types.ts";
import type { ExeDevHttpClient } from "./types.ts";

/** Dependencies injectable for unit tests. */
export interface SandboxRunnerFactoryDeps {
  commandRunner?: CommandRunner;
  exeDevHttp?: ExeDevHttpClient;
}

/** Creates the {@link SandboxRunner} for a provider. */
export function createSandboxRunner(
  provider: SandboxProvider,
  deps: SandboxRunnerFactoryDeps = {},
): SandboxRunner {
  switch (provider) {
    case "none":
      return new HostRunner(deps.commandRunner);
    case "docker":
      return new DockerRunner(deps.commandRunner);
    case "exe.dev":
      return new ExeDevRunner(deps.exeDevHttp);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported sandbox provider: ${exhaustive}`);
    }
  }
}
