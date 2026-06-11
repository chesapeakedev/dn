// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { handleWorkflowRun } from "./workflow/run.ts";
import {
  extractAgentFlag,
  installWorkflowSupport,
  installWorkflowTemplates,
  listWorkflowStatuses,
  requiredSecretForAgent,
  secretSetupHint,
  updateWorkflowTemplates,
  validateWorkflowInstallation,
  type WorkflowSupportWriteResult,
  type WorkflowTemplateStatus,
  type WorkflowValidationResult,
  type WorkflowWriteResult,
} from "../sdk/workflows/mod.ts";

interface WorkflowCommandConfig {
  json: boolean;
  dryRun: boolean;
}

function showHelp(): void {
  console.log("dn workflows - Manage and run dn GitHub Actions workflows\n");
  console.log("Usage:");
  console.log("  dn workflows <subcommand> [options]\n");
  console.log("Subcommands:");
  console.log("  run        Trigger workflow_dispatch or repository_dispatch");
  console.log("  list       Show installed vs canonical workflow templates");
  console.log("  install    Install missing canonical workflow templates");
  console.log(
    "  update     Install missing templates and update outdated templates",
  );
  console.log("  validate   Validate installed workflow templates\n");
  console.log("Options:");
  console.log(
    "  --agent <name>  Set preferred agent in .github/dn/config.json",
  );
  console.log(
    "                  (opencode, cursor, claude, codex). Use with install.",
  );
  console.log("  --json          Print machine-readable JSON output");
  console.log("  --dry-run       Show what install/update would write");
  console.log("  --help, -h      Show this help message\n");
  console.log("Examples:");
  console.log("  dn workflows run release.yml");
  console.log("  dn workflows run dn.init_stack --repo owner/repo --json");
  console.log("  dn init workflows --agent claude");
  console.log("  dn workflows install --agent opencode --dry-run");
  console.log("  dn workflows validate --json");
}

function parseConfig(
  args: string[],
): { config: WorkflowCommandConfig; rest: string[] } {
  const { agent: _agent, rest: afterAgent } = extractAgentFlag(args);
  const rest: string[] = [];
  const config: WorkflowCommandConfig = {
    json: false,
    dryRun: false,
  };

  for (const arg of afterAgent) {
    if (arg === "--json") {
      config.json = true;
    } else if (arg === "--dry-run") {
      config.dryRun = true;
    } else {
      rest.push(arg);
    }
  }

  return { config, rest };
}

function parseConfigAndAgent(
  args: string[],
): {
  config: WorkflowCommandConfig;
  agent: ReturnType<typeof extractAgentFlag>["agent"];
  rest: string[];
} {
  const { agent, rest: afterAgent } = extractAgentFlag(args);
  const { config, rest } = parseConfig(afterAgent);
  return { config, agent, rest };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printStatuses(statuses: WorkflowTemplateStatus[]): void {
  for (const status of statuses) {
    console.log(
      `${
        status.status.padEnd(8)
      } ${status.template.id} -> ${status.template.install_path}`,
    );
  }
}

function printSupportResults(
  results: WorkflowSupportWriteResult[],
  action: string,
): void {
  for (const result of results) {
    const verb = result.dry_run ? `Would ${action}` : pastTense(action);
    console.log(`${verb}: ${result.path}`);
  }
}

function printWriteResults(
  results: WorkflowWriteResult[],
  action: string,
): void {
  if (results.length === 0) {
    console.log("No workflow templates changed.");
    return;
  }

  for (const result of results) {
    const verb = result.dry_run ? `Would ${action}` : pastTense(action);
    console.log(
      `${verb}: ${result.template.id} -> ${result.template.install_path}`,
    );
  }
}

function printAgentSetupHint(
  agent: NonNullable<ReturnType<typeof extractAgentFlag>["agent"]>,
): void {
  console.log("");
  console.log(`Agent: ${agent}`);
  const secret = requiredSecretForAgent(agent);
  if (secret) {
    console.log(
      `Set repository secret (${secret}): ${secretSetupHint(agent)}`,
    );
  }
  console.log(
    "Commit .github/dn/config.json and .github/dn/install-agent.sh, then re-run workflows.",
  );
}

function printValidation(result: WorkflowValidationResult): void {
  printStatuses(result.templates);

  if (result.warnings.length === 0) {
    console.log("");
    console.log("Workflow validation passed.");
    return;
  }

  console.log("");
  console.log("Warnings:");
  for (const warning of result.warnings) {
    console.log(`  - ${warning.template_id}: ${warning.message}`);
  }
}

function pastTense(value: string): string {
  if (value === "install") {
    return "Installed";
  }
  if (value === "update") {
    return "Updated";
  }
  return value;
}

async function runInstall(
  repoRoot: string,
  config: WorkflowCommandConfig,
  agent: ReturnType<typeof extractAgentFlag>["agent"],
): Promise<void> {
  const support = await installWorkflowSupport(repoRoot, {
    agent,
    dryRun: config.dryRun,
    updateScript: false,
  });
  const results = await installWorkflowTemplates(repoRoot, {
    dryRun: config.dryRun,
    updateExisting: false,
  });

  if (config.json) {
    printJson({ dry_run: config.dryRun, support, results });
  } else {
    printSupportResults(support, "install");
    printWriteResults(results, "install");
    if (agent) {
      printAgentSetupHint(agent);
    }
  }
}

/**
 * Handle `dn workflows` subcommands.
 */
export async function handleWorkflows(args: string[]): Promise<void> {
  // `run` has its own --json flag (stdin JSON vs output JSON), so bypass
  // the shared config parser to avoid a flag collision.
  if (args[0] === "run") {
    await handleWorkflowRun(args.slice(1));
    return;
  }

  const { config, agent, rest } = parseConfigAndAgent(args);
  const subcommand = rest[0];

  if (
    !subcommand || subcommand === "help" || subcommand === "--help" ||
    subcommand === "-h"
  ) {
    showHelp();
    return;
  }

  const repoRoot = Deno.cwd();

  if (subcommand === "list") {
    const statuses = await listWorkflowStatuses(repoRoot);
    config.json ? printJson({ templates: statuses }) : printStatuses(statuses);
    return;
  }

  if (subcommand === "install") {
    await runInstall(repoRoot, config, agent);
    return;
  }

  if (subcommand === "update") {
    const support = await installWorkflowSupport(repoRoot, {
      agent,
      dryRun: config.dryRun,
      updateScript: true,
    });
    const results = await updateWorkflowTemplates(repoRoot, {
      dryRun: config.dryRun,
    });
    if (config.json) {
      printJson({ dry_run: config.dryRun, support, results });
    } else {
      printSupportResults(support, "update");
      printWriteResults(results, "update");
      if (agent) {
        printAgentSetupHint(agent);
      }
    }
    return;
  }

  if (subcommand === "validate") {
    const result = await validateWorkflowInstallation(repoRoot);
    config.json ? printJson(result) : printValidation(result);
    if (!result.ok) {
      Deno.exit(1);
    }
    return;
  }

  console.error(`Unknown workflows subcommand: ${subcommand}\n`);
  showHelp();
  Deno.exit(1);
}

/**
 * Handle `dn init workflows` as the canonical install shortcut.
 */
export async function handleInitWorkflows(args: string[]): Promise<void> {
  const { config, agent, rest } = parseConfigAndAgent(args);
  if (rest.length > 0) {
    throw new Error(`Unexpected argument: ${rest[0]}`);
  }
  await runInstall(Deno.cwd(), config, agent);
}
