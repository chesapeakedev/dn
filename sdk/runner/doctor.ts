// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join, resolve } from "@std/path";
import { AGENT_HARNESSES, type AgentHarness } from "../github/agentHarness.ts";
import { RunnerApiClient } from "./client.ts";
import type { LocalRunnerConfig } from "./config.ts";
import {
  getRunnerConfigPaths,
  loadRunnerConfig,
  loadRunnerCredential,
} from "./config.ts";
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
  /** Opaque Denoise account identifier, when recorded during pairing. */
  owner_id?: string;
  /** Owner-facing device name. */
  display_name: string;
  /** Paired Denoise API origin. */
  api_url: string;
  /** ISO-8601 credential expiration. */
  expires_at: string;
}

/** Result of asking Denoise whether this pairing still checks in. */
export type RunnerRemoteProbeResult =
  | {
    /** Denoise accepted the runner credential. */
    kind: "ok";
    /** ISO-8601 time of the last accepted heartbeat. */
    last_seen_at: string;
    /** Owner-visible runner state from the status endpoint. */
    state: string;
  }
  | {
    /** Denoise returned invalid-or-expired for this credential. */
    kind: "rejected";
    /** Server or transport error text. */
    error: string;
  }
  | {
    /** The status request failed without a credential rejection. */
    kind: "unreachable";
    /** Server or transport error text. */
    error: string;
  };

/** Local evidence that the serve loop is still making progress. */
export interface RunnerServeLoopActivity {
  /** mtime of `loop.alive` when the current dn build has been writing it. */
  aliveAtMs?: number;
  /** mtime of `runner.log` used for older LaunchAgent builds. */
  lastLogAtMs?: number;
  /** Last non-empty line of `runner.log`, when readable. */
  lastLogLine?: string;
  /** Elapsed process time from `ps`, when the PID is still alive. */
  processAgeMs?: number;
}

/** Age after which `loop.alive` plus a running PID means the serve loop is hung. */
export const STALE_RUNNER_LOOP_ALIVE_MS = 120_000;

/** Age after which an idle `runner.log` plus a running PID means the loop is hung. */
export const STALE_RUNNER_LOOP_LOG_MS = 10 * 60_000;

/** Startup window where leftover stamps from a previous process are ignored. */
export const RUNNER_LOOP_START_GRACE_MS = 90_000;

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
  /** Injected Denoise status probe used by tests. */
  probeRemote?: () => Promise<RunnerRemoteProbeResult>;
  /** Injected serve-loop liveness probe used by tests. */
  inspectServeLoop?: () => Promise<RunnerServeLoopActivity>;
  /** Clock used to decide whether the last heartbeat or loop stamp is stale. */
  nowMs?: number;
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
    operations: [
      "kickstart",
      "denoise-task",
      "task-sync",
      "land",
      "sync",
      "plan",
      "loop",
    ],
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
  hungReason?: string | null,
): RunnerDoctorCheck {
  if (service.running) {
    if (hungReason) {
      return {
        name: "service",
        ok: false,
        message: hungReason,
      };
    }
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

function formatCoarseAge(deltaMs: number): string {
  if (deltaMs < 60_000) {
    return `${String(Math.max(1, Math.floor(deltaMs / 1000)))}s`;
  }
  if (deltaMs < 3_600_000) {
    return `${String(Math.floor(deltaMs / 60_000))}m`;
  }
  if (deltaMs < 86_400_000) {
    return `${String(Math.floor(deltaMs / 3_600_000))}h`;
  }
  return `${String(Math.floor(deltaMs / 86_400_000))}d`;
}

function processLabel(
  supervisor: RunnerServiceStatus["supervisor"],
  pid?: number,
): string {
  const name = supervisor === "systemd"
    ? "systemd user service"
    : "LaunchAgent";
  return pid === undefined ? name : `${name} pid ${String(pid)}`;
}

/**
 * Last log line looks like an in-progress job rather than a stuck idle loop.
 *
 * @param line - Trailing `runner.log` line, if any
 */
export function serveLogShowsActiveJob(line: string | undefined): boolean {
  if (!line) return false;
  if (/\bJob \S+ (succeeded|failed|cancelled|interrupted)\b/i.test(line)) {
    return false;
  }
  return /\b(Claimed job|Starting job|Job \S+ (plan|lint|publish|cancel)|lease lost)\b/i
    .test(line);
}

/**
 * Returns a doctor error when a still-running supervisor PID has a stale loop.
 *
 * `loop.alive` is written only after heartbeat, claim, or lease progress, so a
 * hung HTTPS fetch does not refresh it even though the JS event loop still runs.
 * Older builds fall back to `runner.log` with a longer idle-log threshold.
 *
 * @param input - Local liveness evidence for one running user service
 */
export function serveLoopHungReason(input: {
  nowMs: number;
  supervisor: RunnerServiceStatus["supervisor"];
  pid?: number;
  aliveAtMs?: number;
  lastLogAtMs?: number;
  lastLogLine?: string;
  processAgeMs?: number;
}): string | null {
  const usingAlive = input.aliveAtMs !== undefined;
  const lastProgressAtMs = input.aliveAtMs ?? input.lastLogAtMs;
  if (lastProgressAtMs === undefined) return null;
  if (!usingAlive && serveLogShowsActiveJob(input.lastLogLine)) return null;

  const label = processLabel(input.supervisor, input.pid);
  const processStartedAtMs = input.processAgeMs === undefined
    ? undefined
    : input.nowMs - input.processAgeMs;
  const leftoverFromPreviousProcess = processStartedAtMs !== undefined &&
    lastProgressAtMs + 2_000 < processStartedAtMs;
  if (leftoverFromPreviousProcess) {
    if (
      input.processAgeMs !== undefined &&
      input.processAgeMs < RUNNER_LOOP_START_GRACE_MS
    ) {
      return null;
    }
    return `${label} is running but has not recorded loop progress since it started. The process is hung. Run dn runner install.`;
  }

  const staleAfterMs = usingAlive
    ? STALE_RUNNER_LOOP_ALIVE_MS
    : STALE_RUNNER_LOOP_LOG_MS;
  const ageMs = input.nowMs - lastProgressAtMs;
  if (ageMs <= staleAfterMs) return null;
  return `${label} is running but the serve loop has not progressed in ${
    formatCoarseAge(ageMs)
  }. The process is hung. Run dn runner install.`;
}

async function fileMtimeMs(path: string): Promise<number | undefined> {
  try {
    const mtime = (await Deno.stat(path)).mtime;
    return mtime?.getTime();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    return undefined;
  }
}

async function readLastNonEmptyLine(path: string): Promise<string | undefined> {
  try {
    const file = await Deno.open(path);
    try {
      const size = (await file.stat()).size;
      if (size === 0) return undefined;
      const readSize = Math.min(size, 8192);
      const buf = new Uint8Array(readSize);
      await file.seek(Math.max(0, size - readSize), Deno.SeekMode.Start);
      const n = await file.read(buf);
      const text = new TextDecoder().decode(buf.subarray(0, n ?? 0));
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(
        (line) => line.length > 0,
      );
      return lines.at(-1);
    } finally {
      file.close();
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    return undefined;
  }
}

/** Parses `ps -o etimes=` or `ps -o etime=` into milliseconds. */
export function parsePsElapsedMs(stdout: string): number | undefined {
  const trimmed = stdout.trim().split("\n").at(-1)?.trim() ?? "";
  if (!trimmed) return undefined;
  if (!trimmed.includes(":") && !trimmed.includes("-")) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
  }
  const match = trimmed.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) return undefined;
  const days = Number.parseInt(match[1] ?? "0", 10);
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  const seconds = Number.parseInt(match[4] ?? "0", 10);
  if (
    [days, hours, minutes, seconds].some((value) => !Number.isFinite(value))
  ) {
    return undefined;
  }
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

async function inspectRunnerServeLoopActivity(
  pid: number | undefined,
  probe: RunnerCommandProbe,
): Promise<RunnerServeLoopActivity> {
  const paths = getRunnerConfigPaths();
  const logPath = join(paths.directory, "runner.log");
  const [aliveAtMs, lastLogAtMs, lastLogLine] = await Promise.all([
    fileMtimeMs(paths.alive),
    fileMtimeMs(logPath),
    readLastNonEmptyLine(logPath),
  ]);
  let processAgeMs: number | undefined;
  if (pid !== undefined) {
    const etimes = await probe.run("ps", ["-p", String(pid), "-o", "etimes="]);
    processAgeMs = etimes.success ? parsePsElapsedMs(etimes.stdout) : undefined;
    if (processAgeMs === undefined) {
      const etime = await probe.run("ps", ["-p", String(pid), "-o", "etime="]);
      if (etime.success) processAgeMs = parsePsElapsedMs(etime.stdout);
    }
  }
  return {
    ...(aliveAtMs === undefined ? {} : { aliveAtMs }),
    ...(lastLogAtMs === undefined ? {} : { lastLogAtMs }),
    ...(lastLogLine === undefined ? {} : { lastLogLine }),
    ...(processAgeMs === undefined ? {} : { processAgeMs }),
  };
}

/** Age after which a running LaunchAgent without a Denoise check-in is stuck. */
const STALE_HEARTBEAT_MS = 120_000;

async function probeDenoiseStatus(): Promise<RunnerRemoteProbeResult> {
  const credential = await loadRunnerCredential();
  if (!credential) {
    return { kind: "unreachable", error: "Runner is not paired." };
  }
  try {
    const client = new RunnerApiClient({
      apiUrl: credential.api_url,
      credential: credential.credential,
      requestTimeoutMs: 8_000,
    });
    const remote = await client.status();
    return {
      kind: "ok",
      last_seen_at: remote.runner.last_seen_at,
      state: remote.runner.state,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid or expired runner credential/i.test(message)) {
      return { kind: "rejected", error: message };
    }
    return { kind: "unreachable", error: message };
  }
}

function checkinDoctorCheck(
  remote: RunnerRemoteProbeResult,
  nowMs: number,
): RunnerDoctorCheck {
  if (remote.kind === "rejected") {
    return {
      name: "checkin",
      ok: false,
      message:
        "Denoise rejected this credential; pair again with dn runner connect <code> --install",
    };
  }
  if (remote.kind === "unreachable") {
    return {
      name: "checkin",
      ok: false,
      message:
        `Could not reach Denoise to confirm a heartbeat (${remote.error})`,
    };
  }
  if (remote.state === "busy" || remote.state === "paused") {
    return {
      name: "checkin",
      ok: true,
      message: `Denoise lists this device as ${remote.state}`,
    };
  }
  const then = Date.parse(remote.last_seen_at);
  if (!Number.isFinite(then) || nowMs - then > STALE_HEARTBEAT_MS) {
    return {
      name: "checkin",
      ok: false,
      message:
        "LaunchAgent is running but Denoise has not accepted a heartbeat recently. The serve loop is likely stuck. Run dn runner install. Pair again only if Denoise rejected the credential.",
    };
  }
  return {
    name: "checkin",
    ok: true,
    message: "Denoise accepted a recent heartbeat",
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
      ...(credential.owner_id === undefined
        ? {}
        : { owner_id: credential.owner_id }),
      display_name: credential.display_name,
      api_url: credential.api_url,
      expires_at: credential.expires_at,
    }
    : null;
  const credentialCurrent = safeCredential !== null &&
    Date.parse(safeCredential.expires_at) > Date.now();
  const remote = safeCredential && credentialCurrent
    ? await (options.probeRemote ?? probeDenoiseStatus)()
    : null;
  const pairingRejected = remote?.kind === "rejected";
  const pairingOk = credentialCurrent && !pairingRejected;
  const pairingMessage = !safeCredential
    ? "Not paired; run dn runner connect <code>"
    : pairingRejected
    ? "Denoise rejected this credential; pair again with dn runner connect <code> --install"
    : credentialCurrent
    ? safeCredential.owner_id
      ? `Paired as ${safeCredential.display_name} (Denoise owner ${safeCredential.owner_id})`
      : `Paired as ${safeCredential.display_name} (Denoise owner not recorded; re-pair to record it)`
    : "Runner credential expired; pair again or rotate it before expiration";
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
      ok: pairingOk,
      message: pairingMessage,
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
    const activity = await (options.inspectServeLoop ??
      (() => inspectRunnerServeLoopActivity(service.pid, commandProbe)))();
    const hungReason = serveLoopHungReason({
      nowMs: options.nowMs ?? Date.now(),
      supervisor: service.supervisor,
      pid: service.pid,
      ...activity,
    });
    checks.push(
      serviceDoctorCheck(service, options.expectedServiceCommand, hungReason),
    );
    if (service.running && remote && remote.kind !== "rejected") {
      checks.push(checkinDoctorCheck(remote, options.nowMs ?? Date.now()));
    }
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
