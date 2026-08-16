// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn auth — complementary GitHub authentication (device flow).
 *
 * Prefer `gh auth login` when available. `dn auth` is for users without gh.
 * Token resolution remains: GITHUB_TOKEN → gh auth token → dn cache.
 */

import { runDeviceFlow } from "../sdk/github/deviceFlow.ts";
import {
  DEVICE_CLIENT_ID_ENV_VARS,
  resolveDeviceClientId,
} from "../sdk/github/deviceClientId.ts";
import {
  clearCachedToken,
  getCachedTokenPath,
  type GitHubTokenSource,
  resolveGitHubTokenDetails,
} from "../sdk/github/token.ts";

function sourceLabel(source: GitHubTokenSource): string {
  switch (source) {
    case "env":
      return "GITHUB_TOKEN environment variable";
    case "gh":
      return "GitHub CLI (gh auth token)";
    case "dn":
      return `dn auth cache (${getCachedTokenPath()})`;
  }
}

async function validateToken(
  token: string,
): Promise<{ login: string; scopes: string }> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "dn-auth-status",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Token validation failed: HTTP ${res.status}${
        body ? ` — ${body.slice(0, 200)}` : ""
      }`,
    );
  }
  const data = (await res.json()) as { login?: string };
  const scopes = res.headers.get("x-oauth-scopes") ??
    res.headers.get("X-OAuth-Scopes") ??
    "(not reported — fine-grained or GitHub App token)";
  if (!data.login) {
    throw new Error("Token validation failed: response missing login");
  }
  return { login: data.login, scopes };
}

export function showAuthHelp(): void {
  console.error("dn auth - Complementary GitHub sign-in for dn\n");
  console.error("Usage:");
  console.error("  dn auth              Sign in via browser (device flow)");
  console.error("  dn auth login        Same as dn auth");
  console.error("  dn auth status       Show which token dn would use");
  console.error("  dn auth logout       Clear the dn-cached token only\n");
  console.error(
    "Preferred: use GitHub CLI (`gh auth login`). dn reads `gh auth token`",
  );
  console.error(
    "automatically. Use `dn auth` only if you do not use gh.\n",
  );
  console.error(
    "By default, login uses the Denoise GitHub App. To use your own app",
  );
  console.error(
    `instead, set ${DEVICE_CLIENT_ID_ENV_VARS[0]} (or ${
      DEVICE_CLIENT_ID_ENV_VARS[1]
    }).`,
  );
  console.error("\nCI/scripts: set GITHUB_TOKEN. See docs/authentication.md.");
}

async function handleLogin(): Promise<void> {
  const clientId = resolveDeviceClientId();
  try {
    await runDeviceFlow({ clientId });
    console.error(
      "Successfully signed in. Token cached for dn (used only when GITHUB_TOKEN and gh are unavailable).",
    );
  } catch (e) {
    console.error("Authentication failed:", (e as Error).message);
    Deno.exit(1);
  }
}

async function handleStatus(): Promise<void> {
  let details;
  try {
    details = await resolveGitHubTokenDetails();
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }

  try {
    const { login, scopes } = await validateToken(details.token);
    console.log(`Logged in to github.com as ${login}`);
    console.log(`Token source: ${sourceLabel(details.source)}`);
    console.log(`Scopes: ${scopes}`);
  } catch (e) {
    console.error(`Token found (${sourceLabel(details.source)}) but invalid:`);
    console.error((e as Error).message);
    console.error(
      "Re-run `gh auth login` or `dn auth`, or set a fresh GITHUB_TOKEN.",
    );
    Deno.exit(1);
  }
}

async function handleLogout(): Promise<void> {
  const removed = await clearCachedToken();
  if (removed) {
    console.error(`Cleared dn auth cache at ${getCachedTokenPath()}.`);
  } else {
    console.error("No dn auth cache to clear.");
  }
  console.error(
    "Note: GITHUB_TOKEN and gh credentials are unchanged. Use `gh auth logout` to clear gh.",
  );
}

export async function handleAuth(args: string[]): Promise<void> {
  const sub = args[0];
  if (
    sub === "--help" || sub === "-h" || sub === "help"
  ) {
    showAuthHelp();
    return;
  }

  if (sub === undefined || sub === "login") {
    await handleLogin();
    return;
  }

  if (sub === "status") {
    await handleStatus();
    return;
  }

  if (sub === "logout") {
    await handleLogout();
    return;
  }

  console.error(`Unknown auth subcommand: ${sub}\n`);
  showAuthHelp();
  Deno.exit(1);
}
