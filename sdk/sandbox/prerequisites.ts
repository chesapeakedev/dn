// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { CommandRunner, ExecResult } from "./types.ts";

/** Default command runner using Deno.Command. */
export function createDefaultCommandRunner(): CommandRunner {
  return {
    async run(argv, options = {}): Promise<ExecResult> {
      const [cmd, ...args] = argv;
      const command = new Deno.Command(cmd, {
        args,
        cwd: options.cwd,
        env: options.env,
        stdout: "piped",
        stderr: "piped",
      });
      const result = await command.output();
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      return { code: result.code, stdout, stderr };
    },
  };
}

/** Returns whether `docker` is available on PATH. */
export async function isDockerAvailable(
  runner: CommandRunner = createDefaultCommandRunner(),
): Promise<boolean> {
  const result = await runner.run(["docker", "version"]);
  return result.code === 0;
}

/** Returns whether the Docker daemon responds. */
export async function isDockerDaemonAvailable(
  runner: CommandRunner = createDefaultCommandRunner(),
): Promise<boolean> {
  const result = await runner.run(["docker", "info"]);
  return result.code === 0;
}

/** Returns whether `EXE_TOKEN` is set for exe.dev API calls. */
export function isExeTokenAvailable(): boolean {
  return Boolean(Deno.env.get("EXE_TOKEN")?.trim());
}
