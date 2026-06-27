// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Where kickstart/loop runs: host, local Docker, or exe.dev VM. */
export type SandboxProvider = "none" | "docker" | "exe.dev";

/** How the host workspace is mapped into the sandbox. */
export type SandboxSyncMode = "bind" | "git_clone";

/** Bind mount from host path to sandbox path. */
export interface SandboxMount {
  /** Host-side path (relative to repo root or absolute). */
  source: string;
  /** Path inside the sandbox. */
  target: string;
}

/** Workspace sync policy between host and sandbox. */
export interface SandboxSyncConfig {
  /** `bind` for Docker bind mounts; `git_clone` for exe.dev. */
  mode: SandboxSyncMode;
  /** Paths excluded from sync (host-relative globs). */
  exclude: string[];
}

/** Docker-specific sandbox settings from config.json. */
export interface DockerSandboxConfig {
  /** Container image (must include dn runtime for phase 2). */
  image: string;
  /** Docker network mode; default `none` for isolation. */
  network: "none" | "bridge";
  /** Mount root filesystem read-only when true. */
  read_only_root: boolean;
  /** Bind mounts applied at container start. */
  mounts: SandboxMount[];
  /** Host env var names forwarded into the container. */
  env_pass_through: string[];
}

/** exe.dev-specific sandbox settings from config.json. */
export interface ExeDevSandboxConfig {
  /** exe.dev VM image name. */
  image: string;
  /** Prefix for generated VM names. */
  vm_name_prefix: string;
  /** VM TTL safety net (exe.dev duration string). */
  ttl: string;
  /** Integration tags (e.g. github). */
  integrations: string[];
}

/**
 * Sandbox block from `.github/dn/config.json` schema 1.1.
 *
 * Secrets never appear here; provider credentials come from env vars.
 */
export interface DnSandboxConfig {
  /** Active sandbox provider. */
  provider: SandboxProvider;
  /** Working directory inside the sandbox. */
  workspace: string;
  /** Host ↔ sandbox sync policy. */
  sync: SandboxSyncConfig;
  /** Docker settings when `provider` is `docker`. */
  docker: DockerSandboxConfig;
  /** exe.dev settings when `provider` is `exe.dev`. */
  exe_dev: ExeDevSandboxConfig;
}

/** Inputs passed to {@link SandboxRunner.provision}. */
export interface SandboxContext {
  /** Absolute path to the consumer repository on the host. */
  repoRoot: string;
  /** Resolved sandbox configuration. */
  config: DnSandboxConfig;
  /** When true, log planned commands without mutating infrastructure. */
  dryRun: boolean;
}

/** Handle to a provisioned sandbox (container id or VM name). */
export interface SandboxHandle {
  provider: SandboxProvider;
  /** Docker container id or exe.dev VM name. */
  id: string;
  /** Workspace path inside the sandbox. */
  workspace: string;
  /** When true, lifecycle methods log instead of mutating infrastructure. */
  dryRun?: boolean;
}

/** Options for {@link SandboxRunner.exec}. */
export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/** Result of running a command inside (or on behalf of) a sandbox. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Pluggable sandbox backend used by kickstart/loop.
 */
export interface SandboxRunner {
  readonly provider: SandboxProvider;
  /** Prepare environment (pull image, create VM). */
  provision(ctx: SandboxContext): Promise<SandboxHandle>;
  /** Sync host workspace into the sandbox before agent execution. */
  syncIn(handle: SandboxHandle): Promise<void>;
  /** Run a command inside the sandbox; stream stdout/stderr to the host. */
  exec(
    handle: SandboxHandle,
    cmd: string[],
    opts?: ExecOptions,
  ): Promise<ExecResult>;
  /** Copy artifacts / diff back to the host workspace. */
  syncOut(handle: SandboxHandle): Promise<void>;
  /** Destroy VM / remove container. */
  teardown(handle: SandboxHandle): Promise<void>;
}

/** Active sandbox context passed to agent-phase routing helpers. */
export interface SandboxExecContext {
  runner: SandboxRunner;
  handle: SandboxHandle;
  provider: SandboxProvider;
}

/** Injectable command runner for tests. */
export interface CommandRunner {
  /** Run `argv[0]` with remaining args; return exit code and captured output. */
  run(
    argv: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<ExecResult>;
}

/** Injectable HTTP client for exe.dev control-plane calls. */
export interface ExeDevHttpClient {
  exec(
    token: string,
    command: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ status: number; body: string }>;
}
