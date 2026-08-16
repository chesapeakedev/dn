// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Central GitHub token resolution for dn CLI.
 *
 * Open-source-first order (prefer user-controlled credentials over the
 * complementary dn device-flow cache):
 *   GITHUB_TOKEN (or DANGEROUS_GITHUB_TOKEN) → gh auth token → dn cache → throw.
 */

import { $ } from "$dax";

const ENV_TOKEN_KEY = "GITHUB_TOKEN";
const LEGACY_ENV_TOKEN_KEY = "DANGEROUS_GITHUB_TOKEN";
const AUTH_DOCS_PATH = "docs/authentication.md";

/** Where a resolved GitHub API token came from. */
export type GitHubTokenSource = "env" | "gh" | "dn";

/** Resolved token plus which ladder step produced it. */
export interface ResolvedGitHubToken {
  token: string;
  source: GitHubTokenSource;
}

/** Injectable sources for tests. */
export interface TokenResolverDeps {
  getEnv: (key: string) => string | undefined;
  readGhToken: () => Promise<string | null>;
  readCachedToken: () => Promise<string | null>;
}

/** In-process cache so we only resolve once per run. */
let resolved: Promise<ResolvedGitHubToken> | null = null;

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
export async function readCachedToken(): Promise<string | null> {
  const path = getCachedTokenPath();
  try {
    const content = await Deno.readTextFile(path);
    const token = content.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

async function readGhAuthToken(): Promise<string | null> {
  try {
    const result = await $`gh auth token`.quiet().text();
    const token = (result ?? "").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function defaultDeps(): TokenResolverDeps {
  return {
    getEnv: (key) => Deno.env.get(key),
    readGhToken: readGhAuthToken,
    readCachedToken,
  };
}

/**
 * Resolve a GitHub token and report which source won.
 * Order: env → gh → dn cache (open-source-first / complementary to gh).
 */
export async function resolveGitHubTokenWithSource(
  deps: TokenResolverDeps = defaultDeps(),
): Promise<ResolvedGitHubToken> {
  const envToken = deps.getEnv(ENV_TOKEN_KEY) ??
    deps.getEnv(LEGACY_ENV_TOKEN_KEY);
  if (envToken != null && envToken.trim().length > 0) {
    return { token: envToken.trim(), source: "env" };
  }

  const ghToken = await deps.readGhToken();
  if (ghToken) {
    return { token: ghToken, source: "gh" };
  }

  const cached = await deps.readCachedToken();
  if (cached) {
    return { token: cached, source: "dn" };
  }

  throw new Error(
    "No GitHub token found. To use dn:\n" +
      "  • Preferred: Install GitHub CLI and run `gh auth login`.\n" +
      "  • Complementary: Run `dn auth` if you do not use gh (caches a token for dn).\n" +
      "  • CI/scripts: Set GITHUB_TOKEN with a Personal Access Token.\n\n" +
      `See ${AUTH_DOCS_PATH} for details.`,
  );
}

/**
 * Resolve GitHub token in order: env → gh auth token → cached file → throw.
 * Result is cached for the process so callers can call multiple times without re-running gh.
 */
export async function resolveGitHubToken(): Promise<string> {
  if (resolved) {
    return (await resolved).token;
  }

  resolved = resolveGitHubTokenWithSource();
  return (await resolved).token;
}

/**
 * Resolve token with source, using the same in-process cache as resolveGitHubToken.
 */
export async function resolveGitHubTokenDetails(): Promise<
  ResolvedGitHubToken
> {
  if (resolved) {
    return await resolved;
  }
  resolved = resolveGitHubTokenWithSource();
  return await resolved;
}

/**
 * Delete the complementary dn device-flow token cache.
 * Does not affect gh or environment tokens.
 * @returns true if a cache file was removed
 */
export async function clearCachedToken(): Promise<boolean> {
  const path = getCachedTokenPath();
  try {
    await Deno.remove(path);
    clearTokenCache();
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      clearTokenCache();
      return false;
    }
    throw e;
  }
}

/**
 * Clear the in-process token cache (for tests and after logout).
 */
export function clearTokenCache(): void {
  resolved = null;
}
