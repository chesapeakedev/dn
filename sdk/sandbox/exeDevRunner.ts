// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { createDefaultCommandRunner } from "./prerequisites.ts";
import type { CommandRunner } from "./types.ts";
import type {
  ExecOptions,
  ExecResult,
  ExeDevHttpClient,
  SandboxContext,
  SandboxHandle,
  SandboxRunner,
} from "./types.ts";

const EXE_DEV_API_URL = "https://exe.dev/exec";
const EXE_DEV_API_TIMEOUT_MS = 30_000;

/** Default HTTPS client for exe.dev control-plane commands. */
export function createDefaultExeDevHttpClient(): ExeDevHttpClient {
  return {
    async exec(token, command, options = {}) {
      const response = await fetch(EXE_DEV_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body: command,
        signal: options.signal ??
          AbortSignal.timeout(EXE_DEV_API_TIMEOUT_MS),
      });
      return {
        status: response.status,
        body: await response.text(),
      };
    },
  };
}

function requireExeToken(): string {
  const token = Deno.env.get("EXE_TOKEN")?.trim();
  if (!token) {
    throw new Error(
      "EXE_TOKEN is required for exe.dev sandbox. Run: ssh exe.dev ssh-key generate-api-key",
    );
  }
  return token;
}

function buildVmName(ctx: SandboxContext): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${ctx.config.exe_dev.vm_name_prefix}-${suffix}`;
}

interface SyncState {
  tempBranch: string;
  originalBranch: string;
}

/** Provisions ephemeral VMs on exe.dev. */
export class ExeDevRunner implements SandboxRunner {
  readonly provider = "exe.dev" as const;
  private readonly http: ExeDevHttpClient;
  private readonly commandRunner: CommandRunner;
  private readonly syncState: Map<string, SyncState> = new Map();

  constructor(
    http: ExeDevHttpClient = createDefaultExeDevHttpClient(),
    commandRunner: CommandRunner = createDefaultCommandRunner(),
  ) {
    this.http = http;
    this.commandRunner = commandRunner;
  }

  async provision(ctx: SandboxContext): Promise<SandboxHandle> {
    const vmName = buildVmName(ctx);
    const integrations = ctx.config.exe_dev.integrations.join(",");
    const newCommand = [
      "new",
      vmName,
      "--image",
      ctx.config.exe_dev.image,
      "--ttl",
      ctx.config.exe_dev.ttl,
      ...(integrations ? ["--integrations", integrations] : []),
      "--json",
    ].join(" ");

    if (ctx.dryRun) {
      console.log(
        `[sandbox dry-run] Would POST ${EXE_DEV_API_URL}: ${newCommand}`,
      );
      return {
        provider: "exe.dev",
        id: "dry-run",
        workspace: ctx.config.workspace,
        dryRun: true,
      };
    }

    const token = requireExeToken();
    const response = await this.http.exec(token, newCommand);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `exe.dev VM creation failed (${response.status}): ${response.body}`,
      );
    }

    console.log(`exe.dev sandbox started: ${vmName}`);
    return {
      provider: "exe.dev",
      id: vmName,
      workspace: ctx.config.workspace,
    };
  }

  async exec(
    handle: SandboxHandle,
    cmd: string[],
    _opts?: ExecOptions,
  ): Promise<ExecResult> {
    const command = [
      "ssh",
      handle.id,
      "--",
      ...cmd,
    ].join(" ");
    if (handle.dryRun) {
      console.log(
        `[sandbox dry-run] Would POST ${EXE_DEV_API_URL}: ${command}`,
      );
      return { code: 0, stdout: "", stderr: "" };
    }

    const token = requireExeToken();
    const response = await this.http.exec(token, command);
    if (response.status === 504) {
      return {
        code: 124,
        stdout: "",
        stderr:
          "exe.dev HTTPS API timed out after 30s; use SSH exec for long-running commands",
      };
    }
    if (response.status < 200 || response.status >= 300) {
      return {
        code: 1,
        stdout: "",
        stderr: response.body,
      };
    }
    return { code: 0, stdout: response.body, stderr: "" };
  }

  async syncIn(handle: SandboxHandle): Promise<void> {
    if (handle.dryRun) {
      console.log(
        `[sandbox dry-run] Would sync workspace into exe.dev VM ${handle.id}`,
      );
      return;
    }

    const tempBranch = `sandbox-sync-${crypto.randomUUID().slice(0, 12)}`;
    const currentBranchResult = await this.commandRunner.run([
      "git",
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const originalBranch = currentBranchResult.stdout.trim() || "main";
    this.syncState.set(handle.id, { tempBranch, originalBranch });

    const gitDir = Deno.cwd();
    await this.commandRunner.run(["git", "add", "-A"], { cwd: gitDir });
    await this.commandRunner.run(
      [
        "git",
        "commit",
        "--allow-empty",
        "-m",
        `sandbox sync ${tempBranch}`,
      ],
      { cwd: gitDir },
    );
    await this.commandRunner.run(
      ["git", "branch", "-D", tempBranch],
      { cwd: gitDir },
    );
    await this.commandRunner.run(
      ["git", "checkout", "-b", tempBranch],
      { cwd: gitDir },
    );
    await this.commandRunner.run(
      ["git", "push", "--force", "origin", tempBranch],
      { cwd: gitDir },
    );
    await this.commandRunner.run(
      ["git", "checkout", originalBranch],
      { cwd: gitDir },
    );

    const remoteResult = await this.commandRunner.run(
      ["git", "remote", "get-url", "origin"],
      { cwd: gitDir },
    );
    const remoteUrl = remoteResult.stdout.trim();

    const token = requireExeToken();
    const vmCloneCmd = [
      "ssh",
      handle.id,
      "--",
      `git clone ${remoteUrl} ${handle.workspace} --branch ${tempBranch}`,
    ].join(" ");
    await this.http.exec(token, vmCloneCmd);

    console.log(
      `Synced workspace into exe.dev VM ${handle.id} via branch ${tempBranch}`,
    );
  }

  async syncOut(handle: SandboxHandle): Promise<void> {
    if (handle.dryRun) {
      return;
    }

    const state = this.syncState.get(handle.id);
    if (!state) {
      return;
    }

    const { tempBranch, originalBranch } = state;
    const token = requireExeToken();

    const vmPushCmd = [
      "ssh",
      handle.id,
      "--",
      [
        `cd ${handle.workspace}`,
        "git add -A",
        `git commit --allow-empty -m "sandbox sync out"`,
        `git push origin ${tempBranch}`,
      ].join(" && "),
    ].join(" ");
    await this.http.exec(token, vmPushCmd);

    const gitDir = Deno.cwd();
    await this.commandRunner.run(
      ["git", "fetch", "origin", tempBranch],
      { cwd: gitDir },
    );
    await this.commandRunner.run(
      ["git", "checkout", originalBranch],
      { cwd: gitDir },
    );
    await this.commandRunner.run(
      ["git", "merge", `origin/${tempBranch}`],
      { cwd: gitDir },
    );
    await this.commandRunner.run(
      ["git", "push", "origin", "--delete", tempBranch],
      { cwd: gitDir },
    );

    this.syncState.delete(handle.id);
    console.log(
      `Synced workspace from exe.dev VM ${handle.id}; temp branch ${tempBranch} deleted`,
    );
  }

  async teardown(handle: SandboxHandle): Promise<void> {
    const destroyCommand = `destroy ${handle.id} --json`;
    if (handle.dryRun) {
      console.log(
        `[sandbox dry-run] Would POST ${EXE_DEV_API_URL}: ${destroyCommand}`,
      );
      return;
    }
    const token = requireExeToken();
    const response = await this.http.exec(token, destroyCommand);
    if (response.status < 200 || response.status >= 300) {
      console.warn(
        `exe.dev VM teardown failed (${response.status}): ${response.body}`,
      );
    }
  }
}
