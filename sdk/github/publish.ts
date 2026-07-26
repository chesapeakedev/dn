// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { isCI } from "./output.ts";

/** How kickstart/init stack persist changes to the remote repository. */
export type PublishMode = "none" | "pr" | "direct";

/** How init stack updates an existing milestone stack artifact. */
export type StackMode = "create" | "refresh" | "overwrite";

/** Result of a successful VCS publish operation. */
export interface PublishResult {
  commitSha: string;
  branchName: string;
  prUrl?: string;
  publishMode: PublishMode;
}

/**
 * Parses a publish mode from CLI flags or dispatch payload values.
 *
 * @throws Error when the value is not a supported publish mode
 */
export function parsePublishMode(value: string): PublishMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "pr" || normalized === "direct") {
    return normalized;
  }
  throw new Error(
    `Invalid publish mode "${value}". Expected none, pr, or direct.`,
  );
}

/**
 * Parses stack update mode from CLI flags or dispatch payload values.
 *
 * @throws Error when the value is not a supported stack mode
 */
export function parseStackMode(value: string): StackMode {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "create" || normalized === "refresh" ||
    normalized === "overwrite"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid stack mode "${value}". Expected create, refresh, or overwrite.`,
  );
}

/**
 * Resolves kickstart publish mode from explicit `publish` or legacy `awp` fields.
 */
export function resolveKickstartPublishMode(options: {
  publish?: unknown;
  awp?: unknown;
  defaultMode?: PublishMode;
}): PublishMode {
  if (options.publish !== undefined && options.publish !== null) {
    if (typeof options.publish !== "string") {
      throw new Error("publish must be a string (none, pr, or direct)");
    }
    return parsePublishMode(options.publish);
  }
  if (options.awp === false) return "none";
  if (options.awp === true) return "pr";
  return options.defaultMode ?? "none";
}

/**
 * Resolves init stack update mode from `stack_mode` or legacy `refresh` boolean.
 */
export function resolveStackMode(options: {
  stackMode?: unknown;
  refresh?: unknown;
  defaultMode?: StackMode;
}): StackMode {
  if (options.stackMode !== undefined && options.stackMode !== null) {
    if (typeof options.stackMode !== "string") {
      throw new Error(
        "stack_mode must be a string (create, refresh, or overwrite)",
      );
    }
    return parseStackMode(options.stackMode);
  }
  if (options.refresh === false) return "create";
  if (options.refresh === true) return "refresh";
  return options.defaultMode ?? "create";
}

/** Resolves init stack publish mode. */
export function resolveInitStackPublishMode(options: {
  publish?: unknown;
  defaultMode?: PublishMode;
}): PublishMode {
  if (options.publish !== undefined && options.publish !== null) {
    if (typeof options.publish !== "string") {
      throw new Error("publish must be a string (none, pr, or direct)");
    }
    return parsePublishMode(options.publish);
  }
  return options.defaultMode ?? "none";
}

/**
 * Fails fast when CI would discard unpublished workspace changes.
 *
 * @throws Error when running in CI with publish mode `none`
 */
export function assertPublishAllowedInCi(mode: PublishMode): void {
  if (isCI() && mode === "none") {
    throw new Error(
      "CI environment requires --publish pr|direct (or --awp). " +
        "Without publish mode, changes are discarded when the runner exits.",
    );
  }
}

/**
 * Writes VCS publish results to GitHub Actions `GITHUB_OUTPUT` when set.
 */
export async function writeGithubActionVcsOutputs(
  result: PublishResult,
): Promise<void> {
  const path = Deno.env.get("GITHUB_OUTPUT");
  if (!path) return;

  const lines = [
    `commit_sha=${result.commitSha}`,
    `branch_name=${result.branchName}`,
    `publish_mode=${result.publishMode}`,
  ];
  if (result.prUrl) {
    lines.push(`pr_url=${result.prUrl}`);
  }
  await Deno.writeTextFile(path, lines.join("\n") + "\n", { append: true });
}
