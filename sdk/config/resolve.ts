// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join } from "@std/path";
import { $ } from "$dax";
import { parseDnConfig } from "./parse.ts";
import {
  parseDnSandboxConfig,
  parseSandboxProvider,
} from "../sandbox/config.ts";
import { repositorySlugFromRemote } from "../runner/doctor.ts";
import type {
  DnConfigLayer,
  DnConfigSource,
  DnRfcConfig,
  DnStrictConfig,
  DnSyncConfig,
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

function mergeSandbox(
  current: ResolvedDnConfig["sandbox"],
  next: NonNullable<DnConfigLayer["sandbox"]>,
): NonNullable<ResolvedDnConfig["sandbox"]> {
  return {
    ...(current ?? {} as NonNullable<ResolvedDnConfig["sandbox"]>),
    ...next,
    sync: { ...(current?.sync), ...next.sync },
    docker: { ...(current?.docker), ...next.docker },
    exe_dev: { ...(current?.exe_dev), ...next.exe_dev },
  };
}

function mergeAgentSandbox(
  result: ResolvedDnConfig,
  layer: { agent?: DnConfigLayer["agent"]; sandbox?: DnConfigLayer["sandbox"] },
  source: DnConfigSource,
): void {
  if (layer.agent !== undefined) {
    result.agent = layer.agent;
    result.sources.agent = source;
  }
  if (layer.sandbox !== undefined) {
    result.sandbox = mergeSandbox(result.sandbox, layer.sandbox);
    result.sources.sandbox = source;
  }
}

function mergeRfcStrictSync(
  result: ResolvedDnConfig,
  layer: {
    rfc?: DnRfcConfig;
    strict?: DnStrictConfig;
    sync?: DnSyncConfig;
  },
  source: DnConfigSource,
): void {
  if (layer.rfc !== undefined) {
    result.rfc = { ...(result.rfc ?? {}), ...layer.rfc };
    result.sources.rfc = source;
  }
  if (layer.strict !== undefined) {
    result.strict = { ...(result.strict ?? {}), ...layer.strict };
    result.sources.strict = source;
  }
  if (layer.sync !== undefined) {
    result.sync = { ...(result.sync ?? {}), ...layer.sync };
    result.sources.sync = source;
  }
}

/** Applies a file layer's top-level agent/sandbox/rfc/strict/sync fields. */
function mergeLayer(
  result: ResolvedDnConfig,
  layer: DnConfigLayer,
  source: DnConfigSource,
): void {
  mergeAgentSandbox(result, layer, source);
  mergeRfcStrictSync(result, layer, source);
}

/**
 * Applies user-config semantics: `defaults` (and legacy top-level agent/sandbox),
 * then optional `repos[owner/name]` override.
 */
function mergeUserLayer(
  result: ResolvedDnConfig,
  user: DnConfigLayer,
  repositorySlug: string | undefined,
): void {
  if (user.defaults) {
    mergeAgentSandbox(result, user.defaults, "user");
  }
  // Legacy / flat user shape: top-level agent/sandbox act as defaults.
  mergeAgentSandbox(result, user, "user");
  if (repositorySlug && user.repos?.[repositorySlug]) {
    mergeAgentSandbox(result, user.repos[repositorySlug], "user");
  }
  // User files may carry rfc/strict/sync only if present; project layer still wins later.
  mergeRfcStrictSync(result, user, "user");
}

async function detectRepositorySlug(
  repoRoot: string,
): Promise<string | undefined> {
  const commands = [
    () => $`git -C ${repoRoot} remote get-url origin`.text(),
    () => $`sl -R ${repoRoot} paths default`.text(),
  ];
  for (const readRemote of commands) {
    try {
      return repositorySlugFromRemote((await readRemote()).trim());
    } catch {
      // try next VCS
    }
  }
  return undefined;
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
    if (user) {
      const slug = options.repositorySlug ??
        await detectRepositorySlug(options.repoRoot);
      mergeUserLayer(result, user, slug);
    }
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
