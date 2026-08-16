// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "../github/agentHarness.ts";
import type { DnSandboxConfig } from "../sandbox/types.ts";

/** Personal defaults stored under `defaults` in `~/.dn/config.json`. */
export interface DnUserDefaults {
  /** Default agent preference. */
  agent?: AgentHarness;
  /** Default sandbox configuration. */
  sandbox?: DnSandboxConfig;
}

/** Per-repository override in `~/.dn/config.json` `repos`. */
export interface DnUserRepoOverride {
  /** Repository-specific agent preference. */
  agent?: AgentHarness;
  /** Repository-specific sandbox configuration. */
  sandbox?: DnSandboxConfig;
}

/** Optional RFC corpus settings (project `dn.json` only; behavior in later tickets). */
export interface DnRfcConfig {
  /** Directory for RFCs relative to the repo root. Defaults to `rfcs/`. */
  dir?: string;
}

/** Optional strict-mode settings (project `dn.json` only). */
export interface DnStrictConfig {
  /** Master switch; absent or false means no enforcement. */
  enabled?: boolean;
  /**
   * When true with {@link enabled}, `dn kickstart` and `dn meld` require a
   * non-empty RFC corpus with at least one non-draft RFC.
   */
  require_rfcs?: boolean;
}

/** Configuration values supported by repository and user configuration files. */
export interface DnConfigLayer {
  /** Version of the configuration document. */
  schema_version?: "2.0" | "1.0" | "1.1";
  /** Agent preference for dn workflows. */
  agent?: AgentHarness;
  /** Sandbox defaults. */
  sandbox?: DnSandboxConfig;
  /**
   * Personal defaults (user config only).
   *
   * Equivalent top-level `agent` / `sandbox` on a user file are also accepted
   * as defaults for backward compatibility.
   */
  defaults?: DnUserDefaults;
  /** Per-repository overrides (user config only), keyed by `owner/name`. */
  repos?: Record<string, DnUserRepoOverride>;
  /** RFC corpus settings (project config). */
  rfc?: DnRfcConfig;
  /** Strict enforcement settings (project config). */
  strict?: DnStrictConfig;
}

/** Runtime values which take precedence over file-based configuration. */
export interface DnRuntimeOverrides {
  /** Explicit agent selection. */
  agent?: AgentHarness;
  /** Explicit sandbox provider selection. */
  sandbox_provider?: DnSandboxConfig["provider"];
}

/** Location and ownership of a value in the resolved configuration. */
export type DnConfigSource =
  | "defaults"
  | "user"
  | "repository"
  | "environment"
  | "cli";

/** A resolved configuration and the source of each effective top-level value. */
export interface ResolvedDnConfig extends DnConfigLayer {
  schema_version: "2.0";
  sources: Partial<
    Record<"agent" | "sandbox" | "rfc" | "strict", DnConfigSource>
  >;
}

/** Options controlling configuration discovery. */
export interface ResolveDnConfigOptions {
  /** Repository root to inspect. */
  repoRoot: string;
  /** Override the user config path, primarily for tests. */
  userConfigPath?: string;
  /** Do not read user configuration, as in GitHub Actions. */
  includeUser?: boolean;
  /**
   * Repository slug (`owner/name`) for `repos` overrides.
   *
   * When omitted and user config is included, resolution attempts to detect
   * the slug from the checkout remote.
   */
  repositorySlug?: string;
  /** Environment values to inspect. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
  /** Explicit command-line values. */
  cli?: DnRuntimeOverrides;
}
