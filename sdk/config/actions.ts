// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { ResolvedDnConfig } from "./types.ts";
import type { SandboxProvider } from "../sandbox/types.ts";

/** Repository-safe configuration passed to the dn GitHub Action. */
export interface DnActionsConfig {
  schema_version: "2.0";
  agent?: ResolvedDnConfig["agent"];
  sandbox_provider?: SandboxProvider;
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
