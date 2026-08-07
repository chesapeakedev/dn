// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  type AgentHarness,
  parseAgentHarness,
} from "../github/agentHarness.ts";
import { parseDnSandboxConfig } from "../sandbox/config.ts";
import type { DnConfigLayer } from "./types.ts";

/** Parses a configuration document and rejects malformed known fields. */
export function parseDnConfig(content: string, source: string): DnConfigLayer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid dn config at ${source}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid dn config at ${source}: expected a JSON object`);
  }
  const value = parsed as Record<string, unknown>;
  const schema = value.schema_version;
  if (
    schema !== undefined && schema !== "2.0" && schema !== "1.0" &&
    schema !== "1.1"
  ) {
    throw new Error(
      `Invalid dn config at ${source}: unsupported schema_version ${
        String(schema)
      }`,
    );
  }
  let agent: AgentHarness | undefined;
  if (value.agent !== undefined) {
    if (typeof value.agent !== "string") {
      throw new Error(`Invalid dn config at ${source}: agent must be a string`);
    }
    agent = parseAgentHarness(value.agent);
  }
  return {
    ...(schema ? { schema_version: schema } : {}),
    ...(agent ? { agent } : {}),
    ...(value.sandbox !== undefined
      ? { sandbox: parseDnSandboxConfig(value.sandbox) }
      : {}),
  };
}
