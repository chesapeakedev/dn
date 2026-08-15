// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Per-repository configuration storage in ~/.dn/config.json
 */

import type { AgentHarness } from "../github/agentHarness.ts";
import type { DnUserDefaults, DnUserRepoOverride } from "../config/types.ts";

/**
 * Configuration structure for dn user preferences.
 *
 * Supports the tiered shape (`defaults` + `repos`) while remaining readable by
 * older helpers that only looked at `repos`.
 */
export interface DnConfig {
  /** Personal defaults applied when no per-repo override matches. */
  defaults?: DnUserDefaults;
  /** Per-repository overrides keyed by `owner/name`. */
  repos: Record<string, DnUserRepoOverride>;
}

/**
 * Returns the dn home directory (~/.dn on Unix).
 */
function getDnHomeDir(): string {
  const home = Deno.env.get("HOME");
  const appData = Deno.env.get("APPDATA");
  if (appData) {
    return `${appData.replace(/\//g, "\\")}\\dn`;
  }
  if (home) {
    return `${home}/.dn`;
  }
  return ".dn";
}

/**
 * Path to the config file.
 */
function getConfigPath(): string {
  return `${getDnHomeDir()}/config.json`;
}

/**
 * Ensures ~/.dn directory exists.
 */
async function ensureDnDir(): Promise<void> {
  const dir = getDnHomeDir();
  try {
    await Deno.stat(dir);
  } catch {
    await Deno.mkdir(dir, { recursive: true });
  }
}

/**
 * Load config from ~/.dn/config.json
 */
export async function loadConfig(): Promise<DnConfig> {
  const path = getConfigPath();
  try {
    const content = await Deno.readTextFile(path);
    const parsed = JSON.parse(content) as Partial<DnConfig>;
    return {
      ...(parsed.defaults ? { defaults: parsed.defaults } : {}),
      repos: parsed.repos ?? {},
    };
  } catch {
    return { repos: {} };
  }
}

/**
 * Save config to ~/.dn/config.json
 */
export async function saveConfig(config: DnConfig): Promise<void> {
  await ensureDnDir();
  const path = getConfigPath();
  await Deno.writeTextFile(path, JSON.stringify(config, null, 2));
}

/**
 * Get stored agent preference for a repository.
 */
export async function getRepoAgent(
  owner: string,
  repo: string,
): Promise<AgentHarness | null> {
  const config = await loadConfig();
  return config.repos[`${owner}/${repo}`]?.agent ??
    config.defaults?.agent ??
    null;
}

/**
 * Store agent preference for a repository.
 */
export async function setRepoAgent(
  owner: string,
  repo: string,
  agent: AgentHarness,
): Promise<void> {
  const config = await loadConfig();
  config.repos[`${owner}/${repo}`] = {
    ...(config.repos[`${owner}/${repo}`] ?? {}),
    agent,
  };
  await saveConfig(config);
}
