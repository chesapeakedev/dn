// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "../github/agentHarness.ts";
import type { DnSandboxConfig } from "../sandbox/types.ts";

/** Task/milestone backend for `dn task` / `dn milestone`. */
export type DnWorkspaceBackend = "todo" | "github" | "denoise";

/** Workspace CLI defaults (user or project `dn.json`). */
export interface DnWorkspaceConfig {
  /** Default backend when flags are omitted. */
  default_backend?: DnWorkspaceBackend;
  /** Denoise API origin override for cloud operations. */
  api_url?: string;
}

/** Personal defaults stored under `defaults` in `~/.dn/config.json`. */
export interface DnUserDefaults {
  /** Default agent preference. */
  agent?: AgentHarness;
  /** Default sandbox configuration. */
  sandbox?: DnSandboxConfig;
  /** Workspace/task backend defaults. */
  workspace?: DnWorkspaceConfig;
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

/**
 * Optional `dn sync` settings (project `dn.json`).
 *
 * Absent or empty `preflight` means `dn sync` runs no quality gate. Names must
 * match keys under {@link DnEnsureConfig}; each recipe's `argv` runs once with
 * no fixer agent (same as `dn ensure <name> --no-fix`).
 */
export interface DnSyncConfig {
  /**
   * `ensure` recipe names to run at the repository root before rebasing.
   * Fail-fast. Empty or omitted skips the gate.
   */
  preflight?: string[];
  /**
   * Trunk bookmark or branch name. When omitted, `dn sync` resolves trunk
   * from the Git remote HEAD, then a local `main` ref.
   */
  trunk?: string;
}

/**
 * A named `dn ensure` recipe from project `dn.json`.
 *
 * Frozen argv plus intent: `dn ensure <name>` runs `argv` with no shell, and
 * on failure a fixer agent uses `intent` plus captured output until the
 * command exits 0 or the iteration bound is reached.
 */
export interface DnEnsureRecipe {
  /** Command and arguments, no shell. */
  argv: string[];
  /** Why this command is run and what the fixer agent should do on failure. */
  intent: string;
  /**
   * Maximum gate attempts including the first exec. Defaults to 5 at runtime
   * when omitted.
   */
  iterations?: number;
}

/**
 * Named `dn ensure` recipes keyed by recipe name (`[a-z][a-z0-9_-]*`).
 *
 * Absent or empty means `dn ensure` has no recipes. Repository `dn.json` is
 * the source of truth (team policy), like {@link DnSyncConfig}.
 */
export type DnEnsureConfig = Record<string, DnEnsureRecipe>;

/**
 * Project-specific operator notes for an IDE or CLI harness.
 *
 * Keys are freeform. Values are short strings. Read by agents from `dn.json`;
 * unused by GitHub Actions templates. Do not store secrets here.
 */
export type DnHarnessHints = Record<string, string>;

/**
 * Optional post-implement review settings (project `dn.json` only).
 *
 * When present, `dn kickstart` and `dn land` may run a second implement pass
 * with {@link prompt} injected as review instructions.
 */
export interface DnKickstartReviewConfig {
  /**
   * Repo-relative path to a markdown file or a literal prompt string. When the
   * value resolves to an existing file under the repo root, the file contents
   * are used; otherwise the string is treated as inline markdown. When omitted,
   * runtime defaults to `REVIEW.md` then `review.md` at the repo root.
   */
  prompt?: string;
  /**
   * Skip the review pass when the workspace diff has at most this many added or
   * removed lines (excluding diff headers). Defaults to 100 when `review` is set.
   */
  auto_skip_max_lines?: number;
}

/** Kickstart workflow settings (project `dn.json` only). */
export interface DnKickstartConfig {
  /** Optional review implement pass configuration. */
  review?: DnKickstartReviewConfig;
}

/**
 * Team-suggested harness defaults (project `dn.json` `harness.defaults` only).
 *
 * Overridable by CLI flags, environment variables, user config, and runner job
 * fields where documented. Normalized at parse time into top-level
 * {@link DnConfigLayer} fields for runtime resolution.
 */
export interface DnHarnessDefaults {
  /** Suggested agent harness for kickstart/meld/loop workflows. */
  agent?: AgentHarness;
  /** Suggested sandbox configuration. */
  sandbox?: DnSandboxConfig;
  /** Suggested kickstart phase settings (e.g. review pass). */
  kickstart?: DnKickstartConfig;
}

/** Optional harness suggestion block (project `dn.json` only). */
export interface DnHarnessConfig {
  defaults?: DnHarnessDefaults;
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
  /** Trunk sync settings (project config). */
  sync?: DnSyncConfig;
  /** Named ensure recipes (project config). */
  ensure?: DnEnsureConfig;
  /** Operator notes for a harness session (project config). */
  harness_hints?: DnHarnessHints;
  /** Kickstart phase settings (project config). */
  kickstart?: DnKickstartConfig;
  /** Harness suggestions (project config); normalized into agent/sandbox/kickstart. */
  harness?: DnHarnessConfig;
  /** Workspace/task CLI defaults (project or user config). */
  workspace?: DnWorkspaceConfig;
  /** @deprecated Use `workspace.default_backend`. */
  tasks?: { default_backend?: DnWorkspaceBackend };
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
    Record<
      | "agent"
      | "sandbox"
      | "rfc"
      | "strict"
      | "sync"
      | "ensure"
      | "harness_hints"
      | "kickstart"
      | "harness",
      DnConfigSource
    >
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
