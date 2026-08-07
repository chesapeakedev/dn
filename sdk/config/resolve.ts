// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join } from "@std/path";
import { parseDnConfig } from "./parse.ts";
import {
  parseDnSandboxConfig,
  parseSandboxProvider,
} from "../sandbox/config.ts";
import type {
  DnConfigLayer,
  DnConfigSource,
  ResolvedDnConfig,
  ResolveDnConfigOptions,
} from "./types.ts";

/** Canonical repository configuration filename. */
export const DN_REPOSITORY_CONFIG_PATH = "dn.json";

/** Legacy repository configuration filename retained for migration. */
export const DN_LEGACY_CONFIG_PATH = ".github/dn/config.json";

function defaultUserConfigPath(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  return home ? join(home, ".dn", "config.json") : join(".dn", "config.json");
}

async function readOptional(
  path: string,
  label: string,
): Promise<DnConfigLayer | null> {
  try {
    return parseDnConfig(await Deno.readTextFile(path), label);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function mergeLayer(
  result: ResolvedDnConfig,
  layer: DnConfigLayer,
  source: DnConfigSource,
): void {
  if (layer.agent !== undefined) {
    result.agent = layer.agent;
    result.sources.agent = source;
  }
  if (layer.sandbox !== undefined) {
    result.sandbox = {
      ...(result.sandbox ?? {} as ResolvedDnConfig["sandbox"]),
      ...layer.sandbox,
      sync: { ...(result.sandbox?.sync), ...layer.sandbox.sync },
      docker: { ...(result.sandbox?.docker), ...layer.sandbox.docker },
      exe_dev: { ...(result.sandbox?.exe_dev), ...layer.sandbox.exe_dev },
    };
    result.sources.sandbox = source;
  }
}

/** Resolves built-in, user, repository, environment, and CLI configuration. */
export async function resolveDnConfig(
  options: ResolveDnConfigOptions,
): Promise<ResolvedDnConfig> {
  const result: ResolvedDnConfig = { schema_version: "2.0", sources: {} };
  if (options.includeUser !== false) {
    const user = await readOptional(
      options.userConfigPath ?? defaultUserConfigPath(),
      "user config",
    );
    if (user) mergeLayer(result, user, "user");
  }
  const repository = await readOptional(
    join(options.repoRoot, DN_REPOSITORY_CONFIG_PATH),
    DN_REPOSITORY_CONFIG_PATH,
  ) ??
    await readOptional(
      join(options.repoRoot, DN_LEGACY_CONFIG_PATH),
      DN_LEGACY_CONFIG_PATH,
    );
  if (repository) mergeLayer(result, repository, "repository");
  const env = options.env ??
    (options.includeUser === false ? {} : Deno.env.toObject());
  if (env.DN_AGENT) {
    mergeLayer(result, {
      agent: parseDnConfig(JSON.stringify({ agent: env.DN_AGENT }), "DN_AGENT")
        .agent,
    }, "environment");
  }
  if (env.DN_SANDBOX_PROVIDER) {
    const sandbox = result.sandbox
      ? {
        ...result.sandbox,
        provider: parseSandboxProvider(env.DN_SANDBOX_PROVIDER),
      }
      : parseDnSandboxConfig({ provider: env.DN_SANDBOX_PROVIDER });
    mergeLayer(result, { sandbox }, "environment");
  }
  if (options.cli?.agent) {
    mergeLayer(result, { agent: options.cli.agent }, "cli");
  }
  if (options.cli?.sandbox_provider) {
    const sandbox = result.sandbox
      ? { ...result.sandbox, provider: options.cli.sandbox_provider }
      : parseDnSandboxConfig({ provider: options.cli.sandbox_provider });
    mergeLayer(result, { sandbox }, "cli");
  }
  return result;
}
