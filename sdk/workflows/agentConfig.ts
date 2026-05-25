// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, fromFileUrl, join } from "@std/path";
import {
  type AgentHarness,
  parseAgentHarness,
} from "../github/agentHarness.ts";
import { $ } from "$dax";
import { computeSha256 } from "./mod.ts";

const WORKFLOW_ROOT = dirname(dirname(dirname(fromFileUrl(import.meta.url))));

/** Relative path to the repo agent config consumed by workflows. */
export const DN_CONFIG_REL_PATH = ".github/dn/config.json";

/** Relative path to the shared agent install script. */
export const DN_INSTALL_SCRIPT_REL_PATH = ".github/dn/install-agent.sh";

const INSTALL_SCRIPT_TEMPLATE_PATH = join(
  WORKFLOW_ROOT,
  "templates",
  "workflows",
  "install-agent.sh",
);

/**
 * JSON shape for `.github/dn/config.json` in consumer repositories.
 */
export interface DnWorkflowAgentConfig {
  /** Config schema version. */
  schema_version: "1.0";
  /** Preferred agent harness for all dn workflows in this repo. */
  agent: AgentHarness;
}

/**
 * Result of installing workflow support files (config + install script).
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
export function requiredSecretForAgent(agent: AgentHarness): string {
  if (agent === "claude") {
    return "ANTHROPIC_API_KEY";
  }
  if (agent === "cursor") {
    return "CURSOR_API_KEY";
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
  if (parsed.schema_version !== "1.0") {
    throw new Error(
      `${DN_CONFIG_REL_PATH} schema_version must be "1.0"`,
    );
  }
  if (typeof parsed.agent !== "string") {
    throw new Error(`${DN_CONFIG_REL_PATH} must include string field "agent"`);
  }
  const agent = parseAgentHarness(parsed.agent);
  return { schema_version: "1.0", agent };
}

/**
 * Reads the consumer repo agent config when present.
 */
export async function readDnWorkflowAgentConfig(
  repoRoot: string,
): Promise<DnWorkflowAgentConfig | null> {
  const path = join(repoRoot, DN_CONFIG_REL_PATH);
  try {
    const content = await Deno.readTextFile(path);
    return parseDnWorkflowAgentConfig(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
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

async function readSupportTemplate(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

/**
 * Installs `.github/dn/config.json` and `.github/dn/install-agent.sh`.
 *
 * - When `agent` is set, writes or updates the config with that agent.
 * - When `agent` is omitted and config is missing, writes default `opencode`.
 * - The install script is written when missing or when `updateScript` is true.
 */
export async function installWorkflowSupport(
  repoRoot: string,
  options: {
    agent?: AgentHarness;
    dryRun?: boolean;
    updateScript?: boolean;
  } = {},
): Promise<WorkflowSupportWriteResult[]> {
  const results: WorkflowSupportWriteResult[] = [];
  const configPath = join(repoRoot, DN_CONFIG_REL_PATH);
  const scriptPath = join(repoRoot, DN_INSTALL_SCRIPT_REL_PATH);
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
    const content = formatDnWorkflowAgentConfig(agent);
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

  let shouldWriteScript = options.updateScript === true;
  if (!shouldWriteScript) {
    try {
      await Deno.stat(scriptPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        shouldWriteScript = true;
      } else {
        throw error;
      }
    }
  } else {
    shouldWriteScript = true;
  }

  if (shouldWriteScript) {
    const script = await readSupportTemplate(INSTALL_SCRIPT_TEMPLATE_PATH);
    if (!dryRun) {
      await Deno.mkdir(dirname(scriptPath), { recursive: true });
      await Deno.writeTextFile(scriptPath, script, { mode: 0o755 });
    }
    results.push({
      path: scriptPath,
      written: !dryRun,
      dry_run: dryRun,
    });
  }

  return results;
}

/**
 * Expected sha256 checksum for the shipped install-agent.sh template.
 */
export async function expectedInstallScriptChecksum(): Promise<string> {
  const script = await readSupportTemplate(INSTALL_SCRIPT_TEMPLATE_PATH);
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
        `${DN_CONFIG_REL_PATH} is not installed. Run: dn init workflows --agent <opencode|cursor|claude|codex>`,
    });
    return warnings;
  }

  const scriptStatus = await getInstallScriptStatus(repoRoot);
  if (scriptStatus === "missing") {
    warnings.push({
      code: "dn_install_script_missing",
      message:
        `${DN_INSTALL_SCRIPT_REL_PATH} is not installed. Run: dn workflows update`,
    });
  } else if (scriptStatus === "outdated") {
    warnings.push({
      code: "dn_install_script_outdated",
      message:
        `${DN_INSTALL_SCRIPT_REL_PATH} differs from the canonical template. Run: dn workflows update`,
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
      return warnings;
    }

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
  } catch (error) {
    warnings.push({
      code: "agent_secret_check_skipped",
      message:
        `Could not verify ${requiredSecret} for agent "${config.agent}": ${
          error instanceof Error ? error.message : String(error)
        }`,
    });
  }

  return warnings;
}
