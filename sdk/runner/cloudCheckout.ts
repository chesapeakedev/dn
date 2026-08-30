// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join, resolve } from "@std/path";
import { parseRepositorySlug } from "./types.ts";
import { registerRunnerRepository } from "./config.ts";

/** Env var for the directory that holds cloned GitHub checkouts. */
export const DN_RUNNER_WORKSPACE_ROOT_ENV = "DN_RUNNER_WORKSPACE_ROOT";

/** Default workspace on `ghcr.io/chesapeakedev/dn` images. */
export const DEFAULT_CLOUD_WORKSPACE_ROOT = "/workspace";

/** Result of one git invocation used by {@link ensureCloudCheckout}. */
export interface GitCommandResult {
  /** Whether the process exited 0. */
  success: boolean;
  /** Combined stdout/stderr for failure messages. */
  output: string;
}

/** Injectable git runner for tests. */
export type CloudGitRunner = (
  args: string[],
  cwd: string,
) => Promise<GitCommandResult>;

async function defaultGitRunner(
  args: string[],
  cwd: string,
): Promise<GitCommandResult> {
  const child = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await child.output();
  const output = `${new TextDecoder().decode(result.stdout)}${
    new TextDecoder().decode(result.stderr)
  }`.trim();
  return { success: result.success, output };
}

function workspaceRoot(
  env: Record<string, string | undefined>,
): string {
  const override = env[DN_RUNNER_WORKSPACE_ROOT_ENV]?.trim();
  if (override) return resolve(override);
  return DEFAULT_CLOUD_WORKSPACE_ROOT;
}

function checkoutPath(root: string, repository: string): string {
  const slug = parseRepositorySlug(repository);
  const [owner, repo] = slug.split("/");
  return join(root, owner, repo);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function cloneUrl(repository: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${repository}.git`;
}

/**
 * Clones or refreshes `owner/repo` under the cloud workspace and registers it.
 *
 * @returns the absolute checkout path
 */
export async function ensureCloudCheckout(input: {
  repository: string;
  token: string;
  env?: Record<string, string | undefined>;
  git?: CloudGitRunner;
}): Promise<string> {
  const slug = parseRepositorySlug(input.repository);
  const env = input.env ?? Deno.env.toObject();
  const dest = checkoutPath(workspaceRoot(env), slug);
  const git = input.git ?? defaultGitRunner;
  const parent = dest.slice(0, dest.lastIndexOf("/"));
  await Deno.mkdir(parent, { recursive: true });
  const gitDir = join(dest, ".git");
  if (await pathExists(gitDir)) {
    const fetchResult = await git(
      ["fetch", "--depth", "1", "origin"],
      dest,
    );
    if (!fetchResult.success) {
      throw new Error(
        `git fetch failed for ${slug}: ${
          fetchResult.output || "unknown error"
        }`,
      );
    }
    const resetResult = await git(["reset", "--hard", "FETCH_HEAD"], dest);
    if (!resetResult.success) {
      throw new Error(
        `git reset failed for ${slug}: ${
          resetResult.output || "unknown error"
        }`,
      );
    }
  } else {
    if (await pathExists(dest)) {
      await Deno.remove(dest, { recursive: true });
    }
    const cloneResult = await git(
      ["clone", "--depth", "1", cloneUrl(slug, input.token), dest],
      parent,
    );
    if (!cloneResult.success) {
      throw new Error(
        `git clone failed for ${slug}: ${
          cloneResult.output || "unknown error"
        }`,
      );
    }
  }
  await registerRunnerRepository(slug, dest);
  return dest;
}
