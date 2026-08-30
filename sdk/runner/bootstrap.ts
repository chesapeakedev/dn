// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  getRunnerConfigPaths,
  loadRunnerCredential,
  RUNNER_CONFIG_SCHEMA_VERSION,
  type RunnerConfigPaths,
  saveRunnerCredential,
  type StoredRunnerCredential,
} from "./config.ts";

/** Env var holding the runner-scoped bearer for unattended VM pairing. */
export const DN_RUNNER_CREDENTIAL_ENV = "DN_RUNNER_CREDENTIAL";
/** Env var holding the Denoise API origin the serve loop should call. */
export const DN_RUNNER_API_URL_ENV = "DN_RUNNER_API_URL";
/** Env var holding the opaque runner id. */
export const DN_RUNNER_ID_ENV = "DN_RUNNER_ID";
/** Env var holding the owner-facing runner name. */
export const DN_RUNNER_DISPLAY_NAME_ENV = "DN_RUNNER_DISPLAY_NAME";
/** Env var holding the Denoise account that owns this runner. */
export const DN_RUNNER_OWNER_ID_ENV = "DN_RUNNER_OWNER_ID";
/** Env var holding ISO-8601 credential expiry. */
export const DN_RUNNER_EXPIRES_AT_ENV = "DN_RUNNER_EXPIRES_AT";
/** Env var set to `exe.dev` on hosted pet VMs. */
export const DN_RUNNER_PROVIDER_ENV = "DN_RUNNER_PROVIDER";

function envValue(
  env: Record<string, string | undefined>,
  name: string,
): string {
  return env[name]?.trim() ?? "";
}

/**
 * Returns true when this process should clone checkouts and claim GitHub
 * tokens like an exe.dev pet VM instead of using a pre-registered laptop path.
 */
export function cloudRunnerEnabled(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): boolean {
  return envValue(env, DN_RUNNER_PROVIDER_ENV) === "exe.dev" ||
    envValue(env, "DN_RUNNER_CLOUD") === "1";
}

/**
 * Reads pairing fields from the environment without writing them.
 *
 * @returns null when the required pairing env vars are missing
 */
export function runnerCredentialFromEnv(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): StoredRunnerCredential | null {
  const credential = envValue(env, DN_RUNNER_CREDENTIAL_ENV);
  const apiUrl = envValue(env, DN_RUNNER_API_URL_ENV);
  const runnerId = envValue(env, DN_RUNNER_ID_ENV);
  if (!credential || !apiUrl || !runnerId) return null;
  const expiresAt = envValue(env, DN_RUNNER_EXPIRES_AT_ENV) ||
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const displayName = envValue(env, DN_RUNNER_DISPLAY_NAME_ENV) || "exe.dev";
  const ownerId = envValue(env, DN_RUNNER_OWNER_ID_ENV);
  return {
    schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
    runner_id: runnerId,
    ...(ownerId ? { owner_id: ownerId } : {}),
    display_name: displayName,
    api_url: apiUrl,
    credential,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  };
}

/**
 * Persists an env-supplied runner credential when `credential.json` is missing.
 *
 * Does not overwrite a file written by heartbeat rotation. First boot of an
 * exe.dev pet VM uses this so `dn runner serve` can start without pairing.
 *
 * @returns the on-disk credential, or null when pairing env is absent
 */
export async function bootstrapRunnerCredentialFromEnv(
  env: Record<string, string | undefined> = Deno.env.toObject(),
  paths: RunnerConfigPaths = getRunnerConfigPaths(),
): Promise<StoredRunnerCredential | null> {
  const existing = await loadRunnerCredential(paths);
  if (existing) return existing;
  const fromEnv = runnerCredentialFromEnv(env);
  if (!fromEnv) return null;
  await saveRunnerCredential(fromEnv, paths);
  return fromEnv;
}
