// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Central GitHub token resolution for dn CLI.
 * Order: GITHUB_TOKEN (or DANGEROUS_GITHUB_TOKEN for backward compat) → gh auth token → cached browser token → throw.
 */

import { $ } from "$dax";

const ENV_TOKEN_KEY = "GITHUB_TOKEN";
const LEGACY_ENV_TOKEN_KEY = "DANGEROUS_GITHUB_TOKEN";
const AUTH_DOCS_PATH = "docs/authentication.md";

/** In-process cache so we only resolve once per run. */
let resolved: Promise<string> | null = null;

/**
 * Returns the platform-specific dn config directory.
 * ~/.config/dn on Unix, %APPDATA%\dn on Windows.
 */
export function getDnConfigDir(): string {
  const home = Deno.env.get("HOME");
  const appData = Deno.env.get("APPDATA");
  if (appData) {
    return `${appData.replace(/\//g, "\\")}\\dn`;
  }
  if (home) {
    return `${home}/.config/dn`;
  }
  return ".config/dn";
}

/**
 * Path to the cached GitHub token file (browser/device flow).
 */
export function getCachedTokenPath(): string {
  return `${getDnConfigDir()}/github_token`;
}

/**
 * Read cached token from config dir if present and non-empty.
 */
async function readCachedToken(): Promise<string | null> {
  const path = getCachedTokenPath();
  try {
    const content = await Deno.readTextFile(path);
    const token = content.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Resolve GitHub token in order: env → gh auth token → cached file → throw.
 * Result is cached for the process so callers can call multiple times without re-running gh.
 */
export async function resolveGitHubToken(): Promise<string> {
  if (resolved) {
    return await resolved;
  }

  resolved = (async (): Promise<string> => {
    // 1. Environment variable (CI / scripts). Prefer GITHUB_TOKEN; accept legacy DANGEROUS_GITHUB_TOKEN.
    const envToken = Deno.env.get(ENV_TOKEN_KEY) ??
      Deno.env.get(LEGACY_ENV_TOKEN_KEY);
    if (envToken != null && envToken.trim().length > 0) {
      return envToken.trim();
    }

    // 2. GitHub CLI
    try {
      const result = await $`gh auth token`.quiet().text();
      const token = (result ?? "").trim();
      if (token.length > 0) {
        return token;
      }
    } catch {
      // gh not installed or not logged in; fall through
    }

    // 3. Cached token (browser / device flow)
    const cached = await readCachedToken();
    if (cached) {
      return cached;
    }

    // 4. No token found
    throw new Error(
      "No GitHub token found. To use dn:\n" +
        "  • Preferred: Install GitHub CLI and run `gh auth login` (no token or env var needed).\n" +
        "  • Alternative: Run `dn auth` to sign in in the browser; the token is cached for future runs.\n" +
        "  • CI/scripts: Set GITHUB_TOKEN with a Personal Access Token (fine-grained PAT recommended).\n\n" +
        `See ${AUTH_DOCS_PATH} for details.`,
    );
  })();

  return await resolved;
}

/**
 * Clear the in-process token cache (for tests).
 */
export function clearTokenCache(): void {
  resolved = null;
}
