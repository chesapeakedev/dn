// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, join, resolve } from "@std/path";
import { parseRepositorySlug } from "./types.ts";

/** Schema version used by local device-runner configuration files. */
export const RUNNER_CONFIG_SCHEMA_VERSION = "1.0" as const;

/** Runner credential persisted with user-only permissions. */
export interface StoredRunnerCredential {
  /** Local file schema version. */
  schema_version: typeof RUNNER_CONFIG_SCHEMA_VERSION;
  /** Opaque paired runner identifier. */
  runner_id: string;
  /** Opaque identifier of the Denoise account that approved this runner. */
  owner_id?: string;
  /** Owner-selected device name. */
  display_name: string;
  /** Denoise API origin used during pairing. */
  api_url: string;
  /** Expiring runner-scoped bearer credential. */
  credential: string;
  /** ISO-8601 time at which this value was stored. */
  created_at: string;
  /** ISO-8601 credential expiration. */
  expires_at: string;
}

/** One trusted checkout known only to the local device runner. */
export interface LocalRunnerRepository {
  /** Absolute checkout path retained only on the device. */
  path: string;
  /** ISO-8601 explicit trust confirmation time. */
  trusted_at: string;
}

/** Non-secret local runner settings. */
export interface LocalRunnerConfig {
  /** Local file schema version. */
  schema_version: typeof RUNNER_CONFIG_SCHEMA_VERSION;
  /** Whether the local loop should avoid claiming jobs. */
  paused: boolean;
  /** Local checkout registrations keyed by GitHub slug. */
  repositories: Record<string, LocalRunnerRepository>;
}

/** Stamp file written when the serve loop completes heartbeat, claim, or lease work. */
export const RUNNER_LOOP_ALIVE_FILE = "loop.alive";

/** Resolved filesystem locations used by device-runner storage. */
export interface RunnerConfigPaths {
  /** Private runner state directory. */
  directory: string;
  /** Runner credential file. */
  credential: string;
  /** Repository registration and pause-state file. */
  config: string;
  /** Serve-loop liveness stamp used by `dn runner doctor`. */
  alive: string;
}

function defaultRunnerHome(): string {
  const override = Deno.env.get("DN_RUNNER_HOME")?.trim();
  if (override) return resolve(override);
  const homeDirectory = Deno.env.get("HOME")?.trim();
  if (!homeDirectory) {
    throw new Error("HOME is not set; set DN_RUNNER_HOME for runner storage.");
  }
  return join(homeDirectory, ".dn", "runner");
}

function assertSecureApiUrl(value: string): void {
  const apiUrl = new URL(value);
  const localHttp = apiUrl.protocol === "http:" &&
    (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1");
  if (apiUrl.protocol !== "https:" && !localHttp) {
    throw new Error("Runner API URL must use HTTPS.");
  }
  if (
    apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash ||
    apiUrl.pathname !== "/"
  ) {
    throw new Error("Runner API URL must be an origin without credentials.");
  }
}

/** Returns device-runner configuration paths without creating them. */
export function getRunnerConfigPaths(
  directory: string = defaultRunnerHome(),
): RunnerConfigPaths {
  return {
    directory,
    credential: join(directory, "credential.json"),
    config: join(directory, "config.json"),
    alive: join(directory, RUNNER_LOOP_ALIVE_FILE),
  };
}

/**
 * Records that the serve loop made progress. Doctor treats a stale stamp plus a
 * still-running LaunchAgent/systemd PID as a hung process.
 */
export async function recordRunnerLoopAlive(
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<void> {
  await writePrivateJson(paths.alive, { at: new Date().toISOString() });
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
  if (Deno.build.os !== "windows") {
    await Deno.chmod(directory, 0o700);
  }
}

async function writePrivateJson(
  path: string,
  value: unknown,
): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  if (Deno.build.os !== "windows") {
    await Deno.chmod(path, 0o600);
  }
}

/** Stores a runner-scoped credential with user-only filesystem permissions. */
export async function saveRunnerCredential(
  value: StoredRunnerCredential,
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<void> {
  if (!value.runner_id || !value.credential || !value.api_url) {
    throw new Error("Runner credential is incomplete.");
  }
  assertSecureApiUrl(value.api_url);
  if (!Number.isFinite(Date.parse(value.expires_at))) {
    throw new Error("Runner credential expiration is invalid.");
  }
  await writePrivateJson(paths.credential, value);
}

/** Loads the current runner credential or returns null before pairing. */
export async function loadRunnerCredential(
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<StoredRunnerCredential | null> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(paths.credential),
    ) as Partial<StoredRunnerCredential>;
    if (
      parsed.schema_version !== RUNNER_CONFIG_SCHEMA_VERSION ||
      typeof parsed.runner_id !== "string" ||
      (parsed.owner_id !== undefined && typeof parsed.owner_id !== "string") ||
      typeof parsed.display_name !== "string" ||
      typeof parsed.api_url !== "string" ||
      typeof parsed.credential !== "string" ||
      typeof parsed.created_at !== "string" ||
      typeof parsed.expires_at !== "string"
    ) {
      throw new Error("Stored runner credential has an unsupported format.");
    }
    return parsed as StoredRunnerCredential;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Deletes the local runner credential after server revocation. */
export async function deleteRunnerCredential(
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<void> {
  try {
    await Deno.remove(paths.credential);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Loads local repository registrations and pause state. */
export async function loadRunnerConfig(
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<LocalRunnerConfig> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(paths.config),
    ) as Partial<LocalRunnerConfig>;
    if (
      parsed.schema_version !== RUNNER_CONFIG_SCHEMA_VERSION ||
      typeof parsed.paused !== "boolean" ||
      typeof parsed.repositories !== "object" ||
      parsed.repositories === null
    ) {
      throw new Error("Stored runner configuration has an unsupported format.");
    }
    return parsed as LocalRunnerConfig;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {
        schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
        paused: false,
        repositories: {},
      };
    }
    throw error;
  }
}

/** Persists local repository registrations with user-only permissions. */
export async function saveRunnerConfig(
  value: LocalRunnerConfig,
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<void> {
  await writePrivateJson(paths.config, value);
}

/** Adds or updates an explicitly trusted local repository checkout. */
export async function registerRunnerRepository(
  repository: string,
  path: string,
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<LocalRunnerConfig> {
  const slug = parseRepositorySlug(repository);
  const absolutePath = resolve(path);
  const stat = await Deno.stat(absolutePath);
  if (!stat.isDirectory) {
    throw new Error(`Repository path is not a directory: ${absolutePath}`);
  }
  const config = await loadRunnerConfig(paths);
  config.repositories[slug] = {
    path: absolutePath,
    trusted_at: new Date().toISOString(),
  };
  await saveRunnerConfig(config, paths);
  return config;
}

/** Removes a local repository registration without deleting its checkout. */
export async function unregisterRunnerRepository(
  repository: string,
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<LocalRunnerConfig> {
  const slug = parseRepositorySlug(repository);
  const config = await loadRunnerConfig(paths);
  delete config.repositories[slug];
  await saveRunnerConfig(config, paths);
  return config;
}

/** Updates the locally persisted pause state. */
export async function setRunnerPaused(
  paused: boolean,
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<LocalRunnerConfig> {
  const config = await loadRunnerConfig(paths);
  config.paused = paused;
  await saveRunnerConfig(config, paths);
  return config;
}
