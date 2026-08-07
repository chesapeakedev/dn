// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AgentHarness } from "../github/agentHarness.ts";
import type { DnSandboxConfig } from "../sandbox/types.ts";

/** Configuration values supported by repository and user configuration files. */
export interface DnConfigLayer {
  /** Version of the configuration document. */
  schema_version?: "2.0" | "1.0" | "1.1";
  /** Agent preference for dn workflows. */
  agent?: AgentHarness;
  /** Sandbox defaults. */
  sandbox?: DnSandboxConfig;
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
  sources: Partial<Record<"agent" | "sandbox", DnConfigSource>>;
}

/** Options controlling configuration discovery. */
export interface ResolveDnConfigOptions {
  /** Repository root to inspect. */
  repoRoot: string;
  /** Override the user config path, primarily for tests. */
  userConfigPath?: string;
  /** Do not read user configuration, as in GitHub Actions. */
  includeUser?: boolean;
  /** Environment values to inspect. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
  /** Explicit command-line values. */
  cli?: DnRuntimeOverrides;
}
