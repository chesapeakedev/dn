// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Client ID used for complementary `dn auth` device flow.
 *
 * Default is the public Denoise GitHub App client ID (safe to embed; no secret).
 * Users who prefer not to authorize that app can override with
 * DN_GITHUB_DEVICE_CLIENT_ID or GITHUB_DEVICE_CLIENT_ID.
 */

/** Public Denoise GitHub App client ID (device flow). */
export const DENOISE_GITHUB_APP_CLIENT_ID = "Iv23li3shYrIcEp8Tpj2";

const CLIENT_ID_ENV = "DN_GITHUB_DEVICE_CLIENT_ID";
const FALLBACK_CLIENT_ID_ENV = "GITHUB_DEVICE_CLIENT_ID";

/**
 * Resolve the OAuth/GitHub App client ID for device flow.
 * Env override wins; otherwise the embedded Denoise app ID is used.
 */
export function resolveDeviceClientId(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const override = getEnv(CLIENT_ID_ENV) ?? getEnv(FALLBACK_CLIENT_ID_ENV);
  if (override != null && override.trim().length > 0) {
    return override.trim();
  }
  return DENOISE_GITHUB_APP_CLIENT_ID;
}

/** Env var names documented for bring-your-own client ID. */
export const DEVICE_CLIENT_ID_ENV_VARS = [
  CLIENT_ID_ENV,
  FALLBACK_CLIENT_ID_ENV,
] as const;
