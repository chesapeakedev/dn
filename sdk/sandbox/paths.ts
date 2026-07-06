// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Maps an absolute host path under `repoRoot` to the equivalent path inside
 * the sandbox workspace (e.g. `/Users/me/repo/.dn/tmp/foo` → `/workspace/.dn/tmp/foo`).
 */
export function translateHostPathToSandbox(
  hostPath: string,
  repoRoot: string,
  sandboxWorkspace: string,
): string {
  const normalizedRepo = repoRoot.replace(/\/+$/, "");
  const normalizedHost = hostPath.replace(/\/+$/, "");
  const normalizedSandbox = sandboxWorkspace.replace(/\/+$/, "");

  if (normalizedHost === normalizedRepo) {
    return normalizedSandbox;
  }
  const repoPrefix = `${normalizedRepo}/`;
  if (normalizedHost.startsWith(repoPrefix)) {
    const relative = normalizedHost.slice(repoPrefix.length);
    return `${normalizedSandbox}/${relative}`;
  }
  return hostPath;
}

/** Builds `git add` argv with optional pathspec excludes from sync config. */
export function buildGitAddArgv(excludes: string[]): string[] {
  const argv = ["git", "add", "-A", "--", "."];
  for (const pattern of excludes) {
    argv.push(`:(exclude)${pattern}`);
  }
  return argv;
}
