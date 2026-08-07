// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, join } from "@std/path";
import {
  type AgentHarness,
  parseAgentHarness,
} from "../github/agentHarness.ts";
import { parseDnSandboxConfig } from "../sandbox/config.ts";
import type { DnSandboxConfig } from "../sandbox/types.ts";
import { validateSandboxPrerequisites } from "../sandbox/validate.ts";
import { $ } from "$dax";
import { computeSha256 } from "./mod.ts";
import { resolveDnConfig } from "../config/resolve.ts";

/** Relative path to the repo agent config consumed by workflows. */
export const DN_CONFIG_REL_PATH = ".github/dn/config.json";

/** Relative path to the retired generated agent install script. */
export const DN_INSTALL_SCRIPT_REL_PATH = ".github/dn/install-agent.sh";

const INSTALL_SCRIPT_TEMPLATE_URL = new URL(
  "../../templates/workflows/install-agent.sh",
  import.meta.url,
);

/**
 * JSON shape for `.github/dn/config.json` in consumer repositories.
 */
export interface DnWorkflowAgentConfig {
  /** Config schema version. */
  schema_version: "1.0" | "1.1";
  /** Preferred agent harness for all dn workflows in this repo. */
  agent: AgentHarness;
  /** Optional sandbox provider settings (schema 1.1). */
  sandbox?: DnSandboxConfig;
}

/**
 * Result of installing workflow support files.
 */
export interface WorkflowSupportWriteResult {
  /** Absolute path written or targeted. */
  path: string;
  /** Whether the file was written. */
  written: boolean;
  /** Dry run only reported the operation. */
  dry_run: boolean;
}

/**
 * Returns the GitHub Actions secret name required for an agent harness in CI.
 */
export function requiredSecretForAgent(
  agent: AgentHarness,
):
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "CURSOR_API_KEY"
  | "COPILOT_GITHUB_TOKEN" {
  if (agent === "opencode") return "OPENAI_API_KEY";
  if (agent === "claude") {
    return "ANTHROPIC_API_KEY";
  }
  if (agent === "cursor") {
    return "CURSOR_API_KEY";
  }
  if (agent === "copilot") {
    return "COPILOT_GITHUB_TOKEN";
  }
  return "OPENAI_API_KEY";
}

/**
 * Human setup hint for configuring the secret matching an agent.
 */
export function secretSetupHint(agent: AgentHarness): string {
  const secret = requiredSecretForAgent(agent);
  return `gh secret set ${secret}`;
}

/**
 * Parses and validates `.github/dn/config.json` content.
 */
export function parseDnWorkflowAgentConfig(
  content: string,
): DnWorkflowAgentConfig {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const schemaVersion = parsed.schema_version;
  if (schemaVersion !== "1.0" && schemaVersion !== "1.1") {
    throw new Error(
      `${DN_CONFIG_REL_PATH} schema_version must be "1.0" or "1.1"`,
    );
  }
  if (typeof parsed.agent !== "string") {
    throw new Error(`${DN_CONFIG_REL_PATH} must include string field "agent"`);
  }
  const agent = parseAgentHarness(parsed.agent);

  if (schemaVersion === "1.0") {
    return { schema_version: "1.0", agent };
  }

  const sandbox = parsed.sandbox === undefined
    ? undefined
    : parseDnSandboxConfig(parsed.sandbox);
  return {
    schema_version: "1.1",
    agent,
    ...(sandbox ? { sandbox } : {}),
  };
}

/**
 * Reads the consumer repo agent config when present.
 */
export async function readDnWorkflowAgentConfig(
  repoRoot: string,
): Promise<DnWorkflowAgentConfig | null> {
  const resolved = await resolveDnConfig({ repoRoot, includeUser: false });
  if (!resolved.agent) return null;
  return {
    schema_version: resolved.sandbox ? "1.1" : "1.0",
    agent: resolved.agent,
    ...(resolved.sandbox ? { sandbox: resolved.sandbox } : {}),
  };
}

/**
 * Serializes a valid agent config document.
 */
export function formatDnWorkflowAgentConfig(
  agent: AgentHarness,
): string {
  const config: DnWorkflowAgentConfig = {
    schema_version: "1.0",
    agent,
  };
  return JSON.stringify(config, null, 2) + "\n";
}

async function readSupportTemplate(url: URL): Promise<string> {
  if (url.protocol === "file:") {
    return await Deno.readTextFile(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load dn support template: HTTP ${response.status}`,
    );
  }
  return await response.text();
}

/**
 * Installs `.github/dn/config.json`.
 *
 * - When `agent` is set, writes or updates the config with that agent.
 * - When `agent` is omitted and config is missing, writes default `opencode`.
 */
export async function installWorkflowSupport(
  repoRoot: string,
  options: {
    agent?: AgentHarness;
    dryRun?: boolean;
  } = {},
): Promise<WorkflowSupportWriteResult[]> {
  const results: WorkflowSupportWriteResult[] = [];
  const configPath = join(repoRoot, DN_CONFIG_REL_PATH);
  const dryRun = options.dryRun === true;

  let shouldWriteConfig = options.agent !== undefined;
  if (!shouldWriteConfig) {
    try {
      await Deno.stat(configPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        shouldWriteConfig = true;
      } else {
        throw error;
      }
    }
  }

  if (shouldWriteConfig) {
    const agent = options.agent ?? "opencode";
    let config: DnWorkflowAgentConfig = {
      schema_version: "1.0",
      agent,
    };
    try {
      const existing = await Deno.readTextFile(configPath);
      const parsed = parseDnWorkflowAgentConfig(existing);
      config = { ...parsed, agent };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const content = JSON.stringify(config, null, 2) + "\n";
    if (!dryRun) {
      await Deno.mkdir(dirname(configPath), { recursive: true });
      await Deno.writeTextFile(configPath, content);
    }
    results.push({
      path: configPath,
      written: !dryRun,
      dry_run: dryRun,
    });
  }

  return results;
}

/**
 * Removes the retired generated install script when it was not customized.
 * Returns `"modified"` without removing user-owned content.
 */
export async function removeLegacyInstallScript(
  repoRoot: string,
  options: { dryRun?: boolean } = {},
): Promise<"missing" | "removed" | "modified"> {
  const scriptPath = join(repoRoot, DN_INSTALL_SCRIPT_REL_PATH);
  try {
    const installed = await Deno.readTextFile(scriptPath);
    const canonical = await readSupportTemplate(INSTALL_SCRIPT_TEMPLATE_URL);
    if (installed !== canonical) return "modified";
    if (options.dryRun !== true) await Deno.remove(scriptPath);
    return "removed";
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "missing";
    throw error;
  }
}

/**
 * Expected sha256 checksum for the shipped install-agent.sh template.
 */
export async function expectedInstallScriptChecksum(): Promise<string> {
  const script = await readSupportTemplate(INSTALL_SCRIPT_TEMPLATE_URL);
  return await computeSha256(script);
}

/**
 * Validates that the installed support script matches the shipped template.
 */
export async function getInstallScriptStatus(
  repoRoot: string,
): Promise<"missing" | "current" | "outdated"> {
  const scriptPath = join(repoRoot, DN_INSTALL_SCRIPT_REL_PATH);
  try {
    const installed = await Deno.readTextFile(scriptPath);
    const expected = await expectedInstallScriptChecksum();
    const installedChecksum = await computeSha256(installed);
    return installedChecksum === expected ? "current" : "outdated";
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return "missing";
    }
    throw error;
  }
}

/**
 * Extracts `--agent <name>` from CLI args. Returns the remaining args.
 */
export function extractAgentFlag(
  args: string[],
): { agent: AgentHarness | undefined; rest: string[] } {
  const rest: string[] = [];
  let agent: AgentHarness | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--agent") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --agent");
      }
      agent = parseAgentHarness(value);
      i++;
      continue;
    }
    rest.push(arg);
  }

  return { agent, rest };
}

function parseGitHubRemoteUrl(
  url: string,
): { owner: string; repo: string } | null {
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }
  return null;
}

/**
 * Resolves owner/repo from a checkout without GraphQL verification.
 */
export async function resolveRepoFromRoot(
  repoRoot: string,
): Promise<{ owner: string; repo: string } | null> {
  let hasRepositoryMetadata = false;
  for (const metadata of [".git", ".sl"]) {
    try {
      await Deno.stat(join(repoRoot, metadata));
      hasRepositoryMetadata = true;
      break;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  if (!hasRepositoryMetadata) return null;

  const commands = [
    () => $`git -C ${repoRoot} remote get-url origin`.text(),
    () => $`sl -R ${repoRoot} paths default`.text(),
  ];

  for (const readRemote of commands) {
    try {
      const parsed = parseGitHubRemoteUrl((await readRemote()).trim());
      if (parsed) {
        return parsed;
      }
    } catch {
      // try next VCS command
    }
  }

  return null;
}

/**
 * Non-fatal validation for workflow agent config and required secrets.
 */
export async function validateWorkflowAgentSetup(
  repoRoot: string,
): Promise<Array<{ code: string; message: string }>> {
  const warnings: Array<{ code: string; message: string }> = [];
  const config = await readDnWorkflowAgentConfig(repoRoot);

  if (!config) {
    warnings.push({
      code: "dn_config_missing",
      message:
        `${DN_CONFIG_REL_PATH} is not installed. Run: dn init workflows --agent <opencode|cursor|claude|codex|copilot>`,
    });
    return warnings;
  }

  const scriptStatus = await getInstallScriptStatus(repoRoot);
  if (scriptStatus !== "missing") {
    warnings.push({
      code: "dn_install_script_deprecated",
      message:
        `${DN_INSTALL_SCRIPT_REL_PATH} is no longer used. Remove it after preserving any customizations`,
    });
  }

  const requiredSecret = requiredSecretForAgent(config.agent);
  try {
    const resolved = await resolveRepoFromRoot(repoRoot);
    if (!resolved) {
      warnings.push({
        code: "agent_secret_check_skipped",
        message:
          `Could not determine GitHub repository from ${repoRoot} to verify ${requiredSecret}`,
      });
    } else {
      const { listRepositoryActionSecrets } = await import(
        "../github/secrets.ts"
      );
      const { owner, repo } = resolved;
      const secrets = await listRepositoryActionSecrets(owner, repo);
      if (!secrets.has(requiredSecret)) {
        warnings.push({
          code: "agent_secret_missing",
          message:
            `Agent "${config.agent}" requires repository secret ${requiredSecret}. Run: ${
              secretSetupHint(config.agent)
            }`,
        });
      }
    }
  } catch (error) {
    warnings.push({
      code: "agent_secret_check_skipped",
      message:
        `Could not verify ${requiredSecret} for agent "${config.agent}": ${
          error instanceof Error ? error.message : String(error)
        }`,
    });
  }

  if (config.sandbox) {
    const sandboxWarnings = await validateSandboxPrerequisites(
      config.sandbox.provider,
    );
    warnings.push(...sandboxWarnings);
  }

  return warnings;
}
