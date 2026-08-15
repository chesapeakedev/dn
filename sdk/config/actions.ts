// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, join } from "@std/path";
import { parseDnConfig } from "./parse.ts";
import { DN_LEGACY_CONFIG_PATH, DN_REPOSITORY_CONFIG_PATH } from "./resolve.ts";
import type { ResolvedDnConfig } from "./types.ts";
import type { SandboxProvider } from "../sandbox/types.ts";

/** Repository-safe configuration passed to the dn GitHub Action. */
export interface DnActionsConfig {
  schema_version: "2.0";
  agent?: ResolvedDnConfig["agent"];
  sandbox_provider?: SandboxProvider;
}

/**
 * Legacy Actions bridge document written to `.github/dn/config.json`.
 *
 * Kept on schema 1.0 / 1.1 so existing workflow readers keep working.
 */
export interface DnActionsProjectionDocument {
  schema_version: "1.0" | "1.1";
  agent: NonNullable<ResolvedDnConfig["agent"]>;
  sandbox?: ResolvedDnConfig["sandbox"];
}

/** Serializes only non-secret repository settings for GitHub Actions. */
export function toDnActionsConfig(config: ResolvedDnConfig): DnActionsConfig {
  return {
    schema_version: "2.0",
    ...(config.agent ? { agent: config.agent } : {}),
    ...(config.sandbox?.provider
      ? { sandbox_provider: config.sandbox.provider }
      : {}),
  };
}

/**
 * Builds the `.github/dn/config.json` projection from a project config layer.
 *
 * @returns null when the project layer has no agent (nothing to project)
 */
export function toActionsProjectionDocument(
  project: {
    agent?: ResolvedDnConfig["agent"];
    sandbox?: ResolvedDnConfig["sandbox"];
  },
): DnActionsProjectionDocument | null {
  if (!project.agent) return null;
  if (project.sandbox) {
    return {
      schema_version: "1.1",
      agent: project.agent,
      sandbox: project.sandbox,
    };
  }
  return { schema_version: "1.0", agent: project.agent };
}

/** Options for {@link writeActionsConfigProjection}. */
export interface WriteActionsConfigProjectionOptions {
  /** Skip writing and only report the target path. */
  dryRun?: boolean;
}

/** Result of projecting project `dn.json` into the Actions bridge file. */
export interface WriteActionsConfigProjectionResult {
  /** Absolute path of the bridge file. */
  path: string;
  /** Whether the file was written (false for dry-run or when skipped). */
  written: boolean;
  /** True when no project `dn.json` agent was available to project. */
  skipped: boolean;
}

/**
 * Writes `.github/dn/config.json` as a subset projection of project `dn.json`.
 *
 * Prefers root `dn.json`. Does not fall back to an existing legacy file as the
 * projection source (that file is the destination). Never reads `~/.dn/`.
 */
export async function writeActionsConfigProjection(
  repoRoot: string,
  options: WriteActionsConfigProjectionOptions = {},
): Promise<WriteActionsConfigProjectionResult> {
  const path = join(repoRoot, DN_LEGACY_CONFIG_PATH);
  const projectPath = join(repoRoot, DN_REPOSITORY_CONFIG_PATH);
  let projectContent: string;
  try {
    projectContent = await Deno.readTextFile(projectPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { path, written: false, skipped: true };
    }
    throw error;
  }
  const project = parseDnConfig(projectContent, DN_REPOSITORY_CONFIG_PATH);
  const document = toActionsProjectionDocument(project);
  if (!document) {
    return { path, written: false, skipped: true };
  }
  if (options.dryRun === true) {
    return { path, written: false, skipped: false };
  }
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(
    path,
    `${JSON.stringify(document, null, 2)}\n`,
  );
  return { path, written: true, skipped: false };
}
