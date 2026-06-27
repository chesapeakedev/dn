// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { resolveMountSource } from "./resolve.ts";
import { createDefaultCommandRunner } from "./prerequisites.ts";
import type { CommandRunner } from "./types.ts";
import type {
  DnSandboxConfig,
  ExecOptions,
  ExecResult,
  SandboxContext,
  SandboxHandle,
  SandboxRunner,
} from "./types.ts";

/** Builds `docker run` argv for provisioning a kickstart sandbox container. */
export function buildDockerRunArgs(
  ctx: SandboxContext,
): string[] {
  const { config, repoRoot } = ctx;
  const docker = config.docker;
  const args = [
    "run",
    "--rm",
    "-d",
    "--network",
    docker.network,
    "-w",
    config.workspace,
  ];

  if (docker.read_only_root) {
    args.push("--read-only");
  }

  for (const mount of docker.mounts) {
    const source = resolveMountSource(repoRoot, mount.source);
    args.push("-v", `${source}:${mount.target}`);
  }

  for (const envName of docker.env_pass_through) {
    const value = Deno.env.get(envName);
    if (value !== undefined) {
      args.push("-e", `${envName}=${value}`);
    }
  }

  args.push(docker.image, "sleep", "infinity");
  return args;
}

/** Runs kickstart/loop inside a Docker container (phase 1: lifecycle). */
export class DockerRunner implements SandboxRunner {
  readonly provider = "docker" as const;
  private readonly commandRunner: CommandRunner;

  constructor(commandRunner: CommandRunner = createDefaultCommandRunner()) {
    this.commandRunner = commandRunner;
  }

  async provision(ctx: SandboxContext): Promise<SandboxHandle> {
    const runArgs = buildDockerRunArgs(ctx);
    const argv = ["docker", ...runArgs];

    if (ctx.dryRun) {
      console.log(`[sandbox dry-run] Would run: ${argv.join(" ")}`);
      return {
        provider: "docker",
        id: "dry-run",
        workspace: ctx.config.workspace,
        dryRun: true,
      };
    }

    const result = await this.commandRunner.run(argv, { cwd: ctx.repoRoot });
    if (result.code !== 0) {
      throw new Error(
        `Failed to start Docker sandbox: ${result.stderr || result.stdout}`
          .trim(),
      );
    }

    const containerId = result.stdout.trim();
    if (!containerId) {
      throw new Error("Docker did not return a container id");
    }

    console.log(`Docker sandbox started: ${containerId.slice(0, 12)}`);
    return {
      provider: "docker",
      id: containerId,
      workspace: ctx.config.workspace,
    };
  }

  async exec(
    handle: SandboxHandle,
    cmd: string[],
    opts?: ExecOptions,
  ): Promise<ExecResult> {
    if (handle.dryRun) {
      const quoted = cmd.map((part) => JSON.stringify(part)).join(" ");
      console.log(
        `[sandbox dry-run] Would run: docker exec -w ${
          JSON.stringify(handle.workspace)
        } ${handle.id} ${quoted}`,
      );
      return { code: 0, stdout: "", stderr: "" };
    }

    const argv = [
      "docker",
      "exec",
      "-w",
      opts?.cwd ?? handle.workspace,
      handle.id,
      ...cmd,
    ];
    return await this.commandRunner.run(argv, { env: opts?.env });
  }

  async syncIn(_handle: SandboxHandle): Promise<void> {
    // Bind mounts keep host workspace in sync at provision time.
  }

  async syncOut(_handle: SandboxHandle): Promise<void> {
    // Bind mounts keep host workspace in sync.
  }

  async teardown(handle: SandboxHandle): Promise<void> {
    if (handle.dryRun) {
      console.log(`[sandbox dry-run] Would run: docker stop ${handle.id}`);
      return;
    }
    await this.commandRunner.run(["docker", "stop", handle.id]);
  }
}

/** Formats docker run args for documentation / dry-run output. */
export function formatDockerRunCommand(
  config: DnSandboxConfig,
  repoRoot: string,
): string {
  const ctx: SandboxContext = {
    repoRoot,
    config,
    dryRun: true,
  };
  return ["docker", ...buildDockerRunArgs(ctx)].join(" ");
}
