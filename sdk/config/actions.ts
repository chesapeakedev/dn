// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join } from "@std/path";
import { DN_LEGACY_CONFIG_PATH, DN_REPOSITORY_CONFIG_PATH } from "./resolve.ts";
import type { ResolvedDnConfig } from "./types.ts";
import type { AgentHarness } from "../github/agentHarness.ts";
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
 * Deprecated: new repositories should commit root `dn.json` only. This helper
 * is retained for tests and manual migration but does not write by default.
 */
export function writeActionsConfigProjection(
  repoRoot: string,
  options: WriteActionsConfigProjectionOptions = {},
): Promise<WriteActionsConfigProjectionResult> {
  const path = join(repoRoot, DN_LEGACY_CONFIG_PATH);
  void options;
  return Promise.resolve({ path, written: false, skipped: true });
}

/**
 * Sets `harness.defaults.agent` in repository `dn.json`, creating the file when
 * missing.
 */
export async function upsertRepositoryHarnessAgent(
  repoRoot: string,
  agent: AgentHarness,
  options: WriteActionsConfigProjectionOptions = {},
): Promise<{ path: string; written: boolean }> {
  const path = join(repoRoot, DN_REPOSITORY_CONFIG_PATH);
  let raw: Record<string, unknown> = { schema_version: "2.0" };
  try {
    raw = JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const harness = isPlainObject(raw.harness) ? raw.harness : {};
  const defaults = isPlainObject(harness.defaults) ? harness.defaults : {};
  defaults.agent = agent;
  harness.defaults = defaults;
  raw.harness = harness;
  delete raw.agent;
  const content = `${JSON.stringify(raw, null, 2)}\n`;
  if (options.dryRun === true) {
    return { path, written: false };
  }
  await Deno.writeTextFile(path, content);
  return { path, written: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
