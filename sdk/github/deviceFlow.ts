// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub OAuth 2.0 Device Authorization Grant for dn CLI.
 * See https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

import { getCachedTokenPath, getDnConfigDir } from "./token.ts";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_SCOPE = "repo read:org";

export interface DeviceFlowConfig {
  clientId: string;
  scope?: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponseSuccess {
  access_token: string;
  token_type: string;
  scope?: string;
}

interface TokenResponseError {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "unsupported_grant_type"
    | "incorrect_client_credentials"
    | "incorrect_device_code"
    | "access_denied"
    | "device_flow_disabled";
  error_description?: string;
  interval?: number;
}

/**
 * Open the default browser to the given URL.
 */
async function openBrowser(url: string): Promise<void> {
  const os = Deno.build.os;
  const cmd = os === "darwin"
    ? ["open", url]
    : os === "windows"
    ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
}

/**
 * Request device and user codes from GitHub.
 */
async function requestDeviceCode(
  config: DeviceFlowConfig,
): Promise<DeviceCodeResponse> {
  const scope = config.scope ?? DEFAULT_SCOPE;
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope,
  });
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device code request failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as DeviceCodeResponse;
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("Invalid device code response");
  }
  return data;
}

/**
 * Poll for access token until user authorizes or flow expires.
 */
async function pollForToken(
  config: DeviceFlowConfig,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    device_code: deviceCode,
    grant_type: GRANT_TYPE,
  });
  const deadline = Date.now() + expiresIn * 1000;
  let interval = intervalSeconds * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const res = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const data = await res.json();

    const err = data as TokenResponseError;
    if (err.error) {
      if (err.error === "authorization_pending") {
        continue;
      }
      if (err.error === "slow_down" && err.interval != null) {
        interval = (err.interval + 5) * 1000;
        continue;
      }
      if (err.error === "expired_token") {
        throw new Error("Device code expired. Run `dn auth` again.");
      }
      if (err.error === "access_denied") {
        throw new Error("Authorization was cancelled.");
      }
      throw new Error(
        err.error_description ?? `Device flow error: ${err.error}`,
      );
    }

    const success = data as TokenResponseSuccess;
    if (success.access_token) {
      return success.access_token;
    }
  }

  throw new Error("Device code expired. Run `dn auth` again.");
}

/**
 * Ensure the dn config directory exists and has safe permissions.
 */
async function ensureConfigDir(): Promise<void> {
  const dir = getDnConfigDir();
  await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
}

/**
 * Write the access token to the cache file with safe permissions (read-only for user).
 */
export async function writeCachedToken(token: string): Promise<void> {
  await ensureConfigDir();
  const path = getCachedTokenPath();
  await Deno.writeTextFile(path, token, { mode: 0o600 });
}

/**
 * Run the full device flow: request code, prompt user, poll, cache token.
 * Opens the default browser to the verification URL.
 */
export async function runDeviceFlow(config: DeviceFlowConfig): Promise<string> {
  const { device_code, user_code, verification_uri, interval, expires_in } =
    await requestDeviceCode(config);

  console.error("Open this URL in your browser and enter the code:");
  console.error(`  ${verification_uri}`);
  console.error(`  Code: ${user_code}`);
  console.error("");

  await openBrowser(verification_uri);

  const token = await pollForToken(config, device_code, interval, expires_in);
  await writeCachedToken(token);
  return token;
}
