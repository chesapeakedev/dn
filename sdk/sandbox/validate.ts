// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { SandboxProvider } from "./types.ts";
import {
  isDockerAvailable,
  isDockerDaemonAvailable,
  isExeTokenAvailable,
} from "./prerequisites.ts";

/**
 * Non-fatal warnings when sandbox.provider is set but prerequisites are missing.
 */
export async function validateSandboxPrerequisites(
  provider: SandboxProvider,
): Promise<Array<{ code: string; message: string }>> {
  if (provider === "none") {
    return [];
  }

  const warnings: Array<{ code: string; message: string }> = [];

  if (provider === "docker") {
    if (!(await isDockerAvailable())) {
      warnings.push({
        code: "sandbox_docker_missing",
        message:
          'sandbox.provider is "docker" but `docker` was not found on PATH. Install Docker or set sandbox.provider to "none".',
      });
      return warnings;
    }
    if (!(await isDockerDaemonAvailable())) {
      warnings.push({
        code: "sandbox_docker_daemon_unavailable",
        message:
          'sandbox.provider is "docker" but the Docker daemon is not running. Start Docker or set sandbox.provider to "none".',
      });
    }
    return warnings;
  }

  if (provider === "exe.dev") {
    if (!isExeTokenAvailable()) {
      warnings.push({
        code: "sandbox_exe_token_missing",
        message:
          'sandbox.provider is "exe.dev" but EXE_TOKEN is not set. Run: make exe_dev_token (requires cmds new,ssh,rm)',
      });
    }
    return warnings;
  }

  return warnings;
}

/**
 * Throws when required sandbox prerequisites are missing (CLI provisioning path).
 */
export async function assertSandboxPrerequisites(
  provider: SandboxProvider,
): Promise<void> {
  const warnings = await validateSandboxPrerequisites(provider);
  if (warnings.length > 0) {
    throw new Error(warnings.map((warning) => warning.message).join("\n"));
  }
}
