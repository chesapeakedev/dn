// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join, resolve } from "@std/path";
import { AGENT_HARNESSES, type AgentHarness } from "../github/agentHarness.ts";
import type { LocalRunnerConfig } from "./config.ts";
import { loadRunnerConfig, loadRunnerCredential } from "./config.ts";
import {
  generateRunnerService,
  inspectRunnerService,
  runnerServiceCommandsEqual,
  type RunnerServiceStatus,
} from "./service.ts";
import type { RunnerCapabilities, RunnerRepositoryReadiness } from "./types.ts";
import { RUNNER_PROTOCOL_VERSION } from "./types.ts";

/** Result of one local runner readiness check. */
export interface RunnerDoctorCheck {
  /** Stable check identifier. */
  name: string;
  /** Whether the readiness condition passed. */
  ok: boolean;
  /** Human-readable status or remediation. */
  message: string;
}

/** Complete result returned by `dn runner doctor`. */
export interface RunnerDoctorResult {
  /** Whether every required readiness check passed. */
  ok: boolean;
  /** Protocol version checked by this dn build. */
  protocol_version: typeof RUNNER_PROTOCOL_VERSION;
  /** Non-secret pairing metadata, or null before pairing. */
  credential: RunnerDoctorCredential | null;
  /** Locally detected harness and Docker capabilities. */
  capabilities: RunnerCapabilities;
  /** Slug-only checkout readiness. */
  repositories: RunnerRepositoryReadiness[];
  /** Ordered actionable checks. */
  checks: RunnerDoctorCheck[];
}

/** Non-secret pairing metadata safe to print in doctor JSON output. */
export interface RunnerDoctorCredential {
  /** Opaque paired runner identifier. */
  runner_id: string;
  /** Owner-facing device name. */
  display_name: string;
  /** Paired Denoise API origin. */
  api_url: string;
  /** ISO-8601 credential expiration. */
  expires_at: string;
}

/** Optional overrides for {@link doctorRunner}. */
export interface DoctorRunnerOptions {
  /** Command probe used to detect harnesses and repository remotes. */
  probe?: RunnerCommandProbe;
  /** Injected service inspection used by tests. */
  inspectService?: () => Promise<RunnerServiceStatus>;
  /** Current `dn runner serve` argv compared against the installed unit. */
  expectedServiceCommand?: string[];
  /** Home directory used to resolve the user-service unit path. */
  homeDirectory?: string;
}

/** Injectable command probe used by readiness tests. */
export interface RunnerCommandProbe {
  /** Runs one fixed diagnostic command and captures its result. */
  run(
    command: string,
    args: string[],
    cwd?: string,
  ): Promise<{ success: boolean; stdout: string; stderr: string }>;
}

const defaultCommandProbe: RunnerCommandProbe = {
  async run(command, args, cwd) {
    try {
      const output = await new Deno.Command(command, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        success: output.success,
        stdout: new TextDecoder().decode(output.stdout).trim(),
        stderr: new TextDecoder().decode(output.stderr).trim(),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { success: false, stdout: "", stderr: "command not found" };
      }
      throw error;
    }
  },
};

const HARNESS_COMMANDS: Readonly<Record<AgentHarness, string>> = {
  opencode: "opencode",
  cursor: "agent",
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Extracts a GitHub repository slug from a supported VCS remote URL. */
export function repositorySlugFromRemote(remote: string): string {
  const normalized = remote.trim();
  const match = normalized.match(
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  if (!match) {
    throw new Error(`Remote is not a supported GitHub URL: ${normalized}`);
  }
  return match[1];
}

/**
 * Resolves the repository slug for one checkout without uploading its path.
 */
export async function inspectRunnerRepository(
  path: string,
  probe: RunnerCommandProbe = defaultCommandProbe,
): Promise<{ repository: string; vcs: "sl" | "git" }> {
  const checkout = resolve(path);
  if (await pathExists(join(checkout, ".sl"))) {
    const result = await probe.run("sl", ["paths", "default"], checkout);
    if (!result.success || !result.stdout) {
      throw new Error(
        `Sapling default remote is unavailable: ${
          result.stderr || "run sl paths default"
        }`,
      );
    }
    const remote = result.stdout.includes("=")
      ? result.stdout.slice(result.stdout.indexOf("=") + 1).trim()
      : result.stdout;
    return { repository: repositorySlugFromRemote(remote), vcs: "sl" };
  }
  if (await pathExists(join(checkout, ".git"))) {
    const result = await probe.run(
      "git",
      ["remote", "get-url", "origin"],
      checkout,
    );
    if (!result.success || !result.stdout) {
      throw new Error(
        `Git origin remote is unavailable: ${
          result.stderr || "run git remote get-url origin"
        }`,
      );
    }
    return {
      repository: repositorySlugFromRemote(result.stdout),
      vcs: "git",
    };
  }
  throw new Error("No .sl or .git repository metadata found.");
}

/** Detects installed agent harnesses and Docker without reading credentials. */
export async function detectRunnerCapabilities(
  probe: RunnerCommandProbe = defaultCommandProbe,
): Promise<RunnerCapabilities> {
  const harnessResults = await Promise.all(
    AGENT_HARNESSES.map(async (harness) => ({
      harness,
      available: (await probe.run(
        HARNESS_COMMANDS[harness],
        ["--version"],
      )).success,
    })),
  );
  const docker = await probe.run("docker", ["version"]);
  return {
    operations: ["kickstart", "denoise-task", "task-sync", "land", "sync"],
    harnesses: harnessResults.filter((result) => result.available).map(
      (result) => result.harness,
    ),
    docker: docker.success,
  };
}

/** Checks all explicitly registered checkouts and reports slugs only. */
export async function checkRunnerRepositories(
  config: LocalRunnerConfig,
  probe: RunnerCommandProbe = defaultCommandProbe,
): Promise<RunnerRepositoryReadiness[]> {
  return await Promise.all(
    Object.entries(config.repositories).map(
      async ([repository, registration]) => {
        try {
          const inspected = await inspectRunnerRepository(
            registration.path,
            probe,
          );
          if (
            inspected.repository.toLowerCase() !== repository.toLowerCase()
          ) {
            return {
              repository,
              ready: false,
              reason:
                `Checkout remote is ${inspected.repository}; re-register the correct repository.`,
            };
          }
          return { repository, ready: true };
        } catch (error) {
          return {
            repository,
            ready: false,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      },
    ),
  );
}

function serviceDoctorCheck(
  service: RunnerServiceStatus,
  expectedServiceCommand?: string[],
): RunnerDoctorCheck {
  if (service.running) {
    const supervisor = service.supervisor === "systemd"
      ? "systemd user service"
      : "LaunchAgent";
    const pid = service.pid !== undefined ? ` (pid ${service.pid})` : "";
    const stale = expectedServiceCommand && service.command &&
        !runnerServiceCommandsEqual(service.command, expectedServiceCommand)
      ? ". Installed argv differs from this dn; run dn runner install to refresh."
      : "";
    return {
      name: "service",
      ok: true,
      message: `${supervisor} running${pid}${stale}`,
    };
  }
  if (service.installed) {
    const logHint = service.supervisor === "systemd"
      ? "Check journalctl --user -u denoise-runner.service."
      : "Check ~/.dn/runner/runner.error.log.";
    return {
      name: "service",
      ok: false,
      message:
        `User service installed but not running; start it with dn runner start. ${logHint}`,
    };
  }
  return {
    name: "service",
    ok: false,
    message:
      "No serve loop is running; denoise will show this device offline. Run dn runner install or dn runner serve.",
  };
}

/** Runs actionable local readiness checks for the paired device runner. */
export async function doctorRunner(
  probe?: RunnerCommandProbe,
  options: DoctorRunnerOptions = {},
): Promise<RunnerDoctorResult> {
  const commandProbe = options.probe ?? probe ?? defaultCommandProbe;
  const [credential, config, capabilities] = await Promise.all([
    loadRunnerCredential(),
    loadRunnerConfig(),
    detectRunnerCapabilities(commandProbe),
  ]);
  const repositories = await checkRunnerRepositories(config, commandProbe);
  const safeCredential = credential
    ? {
      runner_id: credential.runner_id,
      display_name: credential.display_name,
      api_url: credential.api_url,
      expires_at: credential.expires_at,
    }
    : null;
  const credentialCurrent = safeCredential !== null &&
    Date.parse(safeCredential.expires_at) > Date.now();
  const checks: RunnerDoctorCheck[] = [
    {
      name: "platform",
      ok: Deno.build.os === "darwin" || Deno.build.os === "linux",
      message: Deno.build.os === "darwin" || Deno.build.os === "linux"
        ? `${Deno.build.os}/${Deno.build.arch} is supported`
        : `${Deno.build.os} is unsupported; device runners require macOS or Linux`,
    },
    {
      name: "user",
      ok: (Deno.build.os !== "darwin" && Deno.build.os !== "linux") ||
        Deno.uid() !== 0,
      message: (Deno.build.os === "darwin" || Deno.build.os === "linux") &&
          Deno.uid() === 0
        ? "Device runners must run as a logged-in non-root user"
        : "Running as a non-root user",
    },
    {
      name: "pairing",
      ok: credentialCurrent,
      message: !safeCredential
        ? "Not paired; run dn runner connect <code>"
        : credentialCurrent
        ? `Paired as ${safeCredential.display_name}`
        : "Runner credential expired; pair again or rotate it before expiration",
    },
    {
      name: "agent",
      ok: capabilities.harnesses.length > 0,
      message: capabilities.harnesses.length > 0
        ? `Detected ${capabilities.harnesses.join(", ")}`
        : "No supported agent found (OpenCode, Cursor, Claude Code, Codex, or Copilot)",
    },
    {
      name: "repository",
      ok: repositories.some((repository) => repository.ready),
      message: repositories.length === 0
        ? "No repository registered; run dn runner register"
        : `${
          repositories.filter((repository) => repository.ready).length
        }/${repositories.length} registered repositories ready`,
    },
  ];
  if (
    safeCredential && (Deno.build.os === "darwin" || Deno.build.os === "linux")
  ) {
    const homeDirectory = options.homeDirectory ?? Deno.env.get("HOME")?.trim();
    const service = options.inspectService
      ? await options.inspectService()
      : homeDirectory
      ? await inspectRunnerService(
        generateRunnerService(["dn", "runner", "serve"], homeDirectory),
      )
      : {
        installed: false,
        running: false,
        supervisor: Deno.build.os === "darwin"
          ? "launchd" as const
          : "systemd" as const,
        path: "",
      };
    checks.push(serviceDoctorCheck(service, options.expectedServiceCommand));
  }
  return {
    ok: checks.every((check) => check.ok),
    protocol_version: RUNNER_PROTOCOL_VERSION,
    credential: safeCredential,
    capabilities,
    repositories,
    checks,
  };
}
