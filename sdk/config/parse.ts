// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  type AgentHarness,
  parseAgentHarness,
} from "../github/agentHarness.ts";
import { parseDnSandboxConfig } from "../sandbox/config.ts";
import type {
  DnConfigLayer,
  DnRfcConfig,
  DnStrictConfig,
  DnUserDefaults,
  DnUserRepoOverride,
} from "./types.ts";

function parseOptionalAgent(
  value: unknown,
  source: string,
  field: string,
): AgentHarness | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(
      `Invalid dn config at ${source}: ${field} must be a string`,
    );
  }
  return parseAgentHarness(value);
}

function parseUserDefaults(
  value: unknown,
  source: string,
): DnUserDefaults {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `Invalid dn config at ${source}: defaults must be an object`,
    );
  }
  const record = value as Record<string, unknown>;
  return {
    ...(record.agent !== undefined
      ? { agent: parseOptionalAgent(record.agent, source, "defaults.agent") }
      : {}),
    ...(record.sandbox !== undefined
      ? { sandbox: parseDnSandboxConfig(record.sandbox) }
      : {}),
  };
}

function parseUserRepoOverride(
  value: unknown,
  source: string,
  slug: string,
): DnUserRepoOverride {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `Invalid dn config at ${source}: repos["${slug}"] must be an object`,
    );
  }
  const record = value as Record<string, unknown>;
  return {
    ...(record.agent !== undefined
      ? {
        agent: parseOptionalAgent(
          record.agent,
          source,
          `repos["${slug}"].agent`,
        ),
      }
      : {}),
    ...(record.sandbox !== undefined
      ? { sandbox: parseDnSandboxConfig(record.sandbox) }
      : {}),
  };
}

function parseRepos(
  value: unknown,
  source: string,
): Record<string, DnUserRepoOverride> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid dn config at ${source}: repos must be an object`);
  }
  const repos: Record<string, DnUserRepoOverride> = {};
  for (
    const [slug, entry] of Object.entries(value as Record<string, unknown>)
  ) {
    repos[slug] = parseUserRepoOverride(entry, source, slug);
  }
  return repos;
}

function parseRfcConfig(value: unknown, source: string): DnRfcConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid dn config at ${source}: rfc must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.dir !== undefined && typeof record.dir !== "string") {
    throw new Error(`Invalid dn config at ${source}: rfc.dir must be a string`);
  }
  return {
    ...(typeof record.dir === "string" ? { dir: record.dir } : {}),
  };
}

function parseStrictConfig(value: unknown, source: string): DnStrictConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid dn config at ${source}: strict must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (
    record.enabled !== undefined && typeof record.enabled !== "boolean"
  ) {
    throw new Error(
      `Invalid dn config at ${source}: strict.enabled must be a boolean`,
    );
  }
  if (
    record.require_rfcs !== undefined &&
    typeof record.require_rfcs !== "boolean"
  ) {
    throw new Error(
      `Invalid dn config at ${source}: strict.require_rfcs must be a boolean`,
    );
  }
  return {
    ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
    ...(typeof record.require_rfcs === "boolean"
      ? { require_rfcs: record.require_rfcs }
      : {}),
  };
}

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
  const agent = parseOptionalAgent(value.agent, source, "agent");
  return {
    ...(schema ? { schema_version: schema } : {}),
    ...(agent ? { agent } : {}),
    ...(value.sandbox !== undefined
      ? { sandbox: parseDnSandboxConfig(value.sandbox) }
      : {}),
    ...(value.defaults !== undefined
      ? { defaults: parseUserDefaults(value.defaults, source) }
      : {}),
    ...(value.repos !== undefined
      ? { repos: parseRepos(value.repos, source) }
      : {}),
    ...(value.rfc !== undefined
      ? { rfc: parseRfcConfig(value.rfc, source) }
      : {}),
    ...(value.strict !== undefined
      ? { strict: parseStrictConfig(value.strict, source) }
      : {}),
  };
}
