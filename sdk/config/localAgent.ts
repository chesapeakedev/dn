// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  type AgentHarness,
  type AgentSelection,
  resolveAgentHarnessFromEnvOnly,
  resolveAgentHarnessFromFlagsAndEnv,
  resolveAgentHarnessFromFlagsAndEnvOrNull,
} from "../github/agentHarness.ts";
import { resolveDnConfig } from "./resolve.ts";

/** Flag inputs shared with {@link resolveAgentHarnessFromFlagsAndEnv}. */
export interface ResolveLocalAgentHarnessOptions {
  /** Repository root used to load `dn.json` / user config. */
  repoRoot: string;
  /** Explicit `--agent` selection, usually from global and subcommand CLI flags. */
  agent?: AgentSelection | null;
  /**
   * Optional `owner/repo` slug for user `repos[...]` overrides. When omitted,
   * {@link resolveDnConfig} detects the slug from the checkout remote.
   */
  repositorySlug?: string;
  /** Override path to `~/.dn/config.json` (tests). */
  userConfigPath?: string;
  /** When false, skip reading user configuration (tests). */
  includeUser?: boolean;
}

/** Why a local agent wins over a Denoise-stamped preference. */
export type LocalAgentSource = "env" | "user_config" | "repo_config";

/** Explicit local agent preference (env or file), without the OpenCode default. */
export interface LocalAgentOverride {
  /** Configured harness. */
  agent: AgentHarness;
  /** Layer that supplied the harness. */
  source: LocalAgentSource;
}

/**
 * Resolves an explicit local agent from env or file config, or null when none
 * is set (does not apply the built-in OpenCode default).
 */
export async function resolveLocalAgentOverride(
  options: ResolveLocalAgentHarnessOptions,
): Promise<LocalAgentOverride | null> {
  if (options.agent) {
    return { agent: options.agent.harness, source: "env" };
  }
  const fromEnv = resolveAgentHarnessFromEnvOnly();
  if (fromEnv) {
    return { agent: fromEnv.harness, source: "env" };
  }
  const config = await resolveDnConfig({
    repoRoot: options.repoRoot,
    ...(options.repositorySlug
      ? { repositorySlug: options.repositorySlug }
      : {}),
    ...(options.userConfigPath != null
      ? { userConfigPath: options.userConfigPath }
      : {}),
    ...(options.includeUser === false ? { includeUser: false } : {}),
    // File layers only; DN_AGENT and *_ENABLED are handled above.
    env: {},
    cli: {},
  });
  if (!config.agent) {
    return null;
  }
  const source: LocalAgentSource = config.sources.agent === "repository"
    ? "repo_config"
    : "user_config";
  return { agent: config.agent, source };
}

/**
 * Resolves the local CLI agent with tiered config fallback.
 *
 * Precedence: CLI `--agent` → `DN_AGENT` → `*_ENABLED` env → project `dn.json` /
 * user config (via {@link resolveDnConfig}) → built-in `opencode`.
 *
 * File config supplies a harness name only. Model and thinking come from CLI
 * or `DN_AGENT`.
 */
export async function resolveLocalAgentHarness(
  options: ResolveLocalAgentHarnessOptions,
): Promise<AgentSelection> {
  const config = await resolveDnConfig({
    repoRoot: options.repoRoot,
    ...(options.repositorySlug
      ? { repositorySlug: options.repositorySlug }
      : {}),
    ...(options.userConfigPath != null
      ? { userConfigPath: options.userConfigPath }
      : {}),
    ...(options.includeUser === false ? { includeUser: false } : {}),
    // File layers only; DN_AGENT and *_ENABLED are handled in the harness helper.
    env: {},
    cli: {},
  });
  return resolveAgentHarnessFromFlagsAndEnv({
    agent: options.agent,
    fallbackAgent: config.agent,
  });
}

/**
 * Like {@link resolveLocalAgentHarness} but returns null instead of the
 * built-in OpenCode default when nothing is configured.
 */
export async function resolveLocalAgentHarnessOrNull(
  options: ResolveLocalAgentHarnessOptions,
): Promise<AgentSelection | null> {
  const config = await resolveDnConfig({
    repoRoot: options.repoRoot,
    ...(options.repositorySlug
      ? { repositorySlug: options.repositorySlug }
      : {}),
    ...(options.userConfigPath != null
      ? { userConfigPath: options.userConfigPath }
      : {}),
    ...(options.includeUser === false ? { includeUser: false } : {}),
    env: {},
    cli: {},
  });
  return resolveAgentHarnessFromFlagsAndEnvOrNull({
    agent: options.agent,
    fallbackAgent: config.agent,
  });
}
