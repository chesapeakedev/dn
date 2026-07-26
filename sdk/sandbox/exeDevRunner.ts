// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { createDefaultCommandRunner } from "./prerequisites.ts";
import { buildGitAddArgv } from "./paths.ts";
import type { CommandRunner } from "./types.ts";
import type {
  ExecOptions,
  ExecResult,
  ExeDevHttpClient,
  SandboxContext,
  SandboxHandle,
  SandboxRunner,
} from "./types.ts";

const DEFAULT_EXE_DEV_API_URL = "https://exe.dev/exec";
const EXE_DEV_API_TIMEOUT_MS = 30_000;

/** Resolve the exe.dev endpoint, allowing an isolated contract twin. */
export function exeDevApiUrl(): string {
  const value = Deno.env.get("EXE_DEV_API_URL") ?? DEFAULT_EXE_DEV_API_URL;
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    Deno.env.get("EXE_DEV_ALLOW_INSECURE_HTTP") !== "1"
  ) {
    throw new Error(
      "EXE_DEV_API_URL must use HTTPS unless EXE_DEV_ALLOW_INSECURE_HTTP=1",
    );
  }
  return url.toString();
}

/** Default HTTPS client for exe.dev control-plane commands. */
export function createDefaultExeDevHttpClient(): ExeDevHttpClient {
  return {
    async exec(token, command, options = {}) {
      const response = await fetch(exeDevApiUrl(), {
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
      "EXE_TOKEN is required for exe.dev sandbox. Run: make exe_dev_token",
    );
  }
  return token;
}

function buildVmName(ctx: SandboxContext): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${ctx.config.exe_dev.vm_name_prefix}-${suffix}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildRemoteShellCommand(
  cwd: string,
  cmd: string[],
  env?: Record<string, string>,
): string {
  const parts: string[] = [`cd ${shellQuote(cwd)}`];
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      parts.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  parts.push(cmd.map(shellQuote).join(" "));
  return parts.join(" && ");
}

interface SyncState {
  branch: string;
  baseCommit: string;
  exclude: string[];
}

function assertCommandSucceeded(
  result: ExecResult,
  description: string,
): void {
  if (result.code !== 0) {
    throw new Error(
      `${description} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

function assertExeRequestSucceeded(
  response: { status: number; body: string },
  description: string,
): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${description} failed (${response.status}): ${response.body}`,
    );
  }
}

/** Provisions ephemeral VMs on exe.dev. */
export class ExeDevRunner implements SandboxRunner {
  readonly provider = "exe.dev" as const;
  private readonly http: ExeDevHttpClient;
  private readonly commandRunner: CommandRunner;
  private readonly syncState: Map<string, SyncState> = new Map();
  private readonly syncExclude: Map<string, string[]> = new Map();
  private readonly repoRoots: Map<string, string> = new Map();

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
        `[sandbox dry-run] Would POST ${exeDevApiUrl()}: ${newCommand}`,
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
    this.syncExclude.set(vmName, ctx.config.sync.exclude);
    this.repoRoots.set(vmName, ctx.repoRoot);
    return {
      provider: "exe.dev",
      id: vmName,
      workspace: ctx.config.workspace,
    };
  }

  async exec(
    handle: SandboxHandle,
    cmd: string[],
    opts?: ExecOptions,
  ): Promise<ExecResult> {
    const cwd = opts?.cwd ?? handle.workspace;
    const remoteCmd = buildRemoteShellCommand(cwd, cmd, opts?.env);
    const command = ["ssh", handle.id, "--", remoteCmd].join(" ");

    if (handle.dryRun) {
      console.log(
        `[sandbox dry-run] Would POST ${exeDevApiUrl()}: ${command}`,
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

    const exclude = this.syncExclude.get(handle.id) ?? [];
    const gitDir = this.repoRoots.get(handle.id) ?? Deno.cwd();
    const currentBranchResult = await this.commandRunner.run([
      "git",
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ], { cwd: gitDir });
    assertCommandSucceeded(
      currentBranchResult,
      "Resolving the sandbox topic branch",
    );
    const branch = currentBranchResult.stdout.trim();
    if (!branch || branch === "HEAD") {
      throw new Error(
        "exe.dev sandbox publishing requires a checked-out topic branch",
      );
    }

    const addResult = await this.commandRunner.run(buildGitAddArgv(exclude), {
      cwd: gitDir,
    });
    assertCommandSucceeded(addResult, "Staging the sandbox input");
    const commitResult = await this.commandRunner.run(
      [
        "git",
        "commit",
        "--allow-empty",
        "-m",
        "dn: synchronize sandbox input",
      ],
      { cwd: gitDir },
    );
    assertCommandSucceeded(commitResult, "Committing the sandbox input");
    const pushResult = await this.commandRunner.run(
      [
        "git",
        "push",
        "--force-with-lease",
        "-u",
        "origin",
        `HEAD:${branch}`,
      ],
      { cwd: gitDir },
    );
    assertCommandSucceeded(pushResult, `Pushing sandbox branch ${branch}`);
    const baseCommitResult = await this.commandRunner.run(
      ["git", "rev-parse", "HEAD"],
      { cwd: gitDir },
    );
    assertCommandSucceeded(
      baseCommitResult,
      "Resolving the sandbox input commit",
    );
    const baseCommit = baseCommitResult.stdout.trim();
    this.syncState.set(handle.id, { branch, baseCommit, exclude });

    const remoteResult = await this.commandRunner.run(
      ["git", "remote", "get-url", "origin"],
      { cwd: gitDir },
    );
    assertCommandSucceeded(remoteResult, "Resolving the GitHub remote");
    const remoteUrl = remoteResult.stdout.trim();

    const token = requireExeToken();
    const refreshWorkspace =
      `if [ -d ${shellQuote(`${handle.workspace}/.git`)} ]; then ` +
      `git -C ${shellQuote(handle.workspace)} fetch origin ${
        shellQuote(branch)
      } && ` +
      `git -C ${shellQuote(handle.workspace)} checkout -B ${
        shellQuote(branch)
      } ${shellQuote(`origin/${branch}`)} && ` +
      `git -C ${shellQuote(handle.workspace)} clean -fdx; else ` +
      `git clone ${shellQuote(remoteUrl)} ${
        shellQuote(handle.workspace)
      } --branch ${shellQuote(branch)}; fi`;
    const response = await this.http.exec(
      token,
      [
        "ssh",
        handle.id,
        "--",
        refreshWorkspace,
      ].join(" "),
    );
    assertExeRequestSucceeded(response, "Refreshing the exe.dev workspace");

    console.log(
      `Synced branch ${branch} into exe.dev VM ${handle.id}`,
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

    const { branch, baseCommit, exclude } = state;
    const token = requireExeToken();
    const vmPushCmd = [
      "ssh",
      handle.id,
      "--",
      [
        `cd ${shellQuote(handle.workspace)}`,
        exclude.length > 0
          ? `git add -A -- . ${
            exclude.map((p) => shellQuote(`:(exclude)${p}`)).join(" ")
          }`
          : "git add -A",
        `git commit --allow-empty -m "dn: synchronize sandbox output"`,
        `git push origin HEAD:${shellQuote(branch)}`,
      ].join(" && "),
    ].join(" ");
    const response = await this.http.exec(token, vmPushCmd);
    assertExeRequestSucceeded(response, "Publishing the exe.dev workspace");

    const gitDir = this.repoRoots.get(handle.id) ?? Deno.cwd();
    const fetchResult = await this.commandRunner.run(
      ["git", "fetch", "origin", branch],
      { cwd: gitDir },
    );
    assertCommandSucceeded(fetchResult, `Fetching sandbox branch ${branch}`);

    const patchPath = await Deno.makeTempFile({
      prefix: "dn-sandbox-",
      suffix: ".patch",
    });
    try {
      const diffResult = await this.commandRunner.run(
        [
          "git",
          "diff",
          "--binary",
          baseCommit,
          `origin/${branch}`,
          "--output",
          patchPath,
        ],
        { cwd: gitDir },
      );
      assertCommandSucceeded(diffResult, "Preparing the sandbox output patch");
      const patch = await Deno.readTextFile(patchPath);
      if (patch.trim()) {
        const applyResult = await this.commandRunner.run(
          ["git", "apply", patchPath],
          { cwd: gitDir },
        );
        assertCommandSucceeded(applyResult, "Applying the sandbox output");
      }
    } finally {
      await Deno.remove(patchPath);
    }

    console.log(
      `Synced exe.dev VM ${handle.id} changes from branch ${branch}`,
    );
  }

  async teardown(handle: SandboxHandle): Promise<void> {
    const destroyCommand = `rm ${handle.id} --json`;
    if (handle.dryRun) {
      console.log(
        `[sandbox dry-run] Would POST ${exeDevApiUrl()}: ${destroyCommand}`,
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
    this.syncState.delete(handle.id);
    this.syncExclude.delete(handle.id);
    this.repoRoots.delete(handle.id);
  }
}
