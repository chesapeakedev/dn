// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  installWorkflowTemplates,
  listWorkflowStatuses,
  updateWorkflowTemplates,
  validateWorkflowInstallation,
  type WorkflowTemplateStatus,
  type WorkflowValidationResult,
  type WorkflowWriteResult,
} from "../sdk/workflows/mod.ts";

interface WorkflowCommandConfig {
  json: boolean;
  dryRun: boolean;
}

function showHelp(): void {
  console.log("dn workflows - Manage canonical dn GitHub Actions workflows\n");
  console.log("Usage:");
  console.log("  dn workflows <subcommand> [options]\n");
  console.log("Subcommands:");
  console.log("  list       Show installed vs canonical workflow templates");
  console.log("  install    Install missing canonical workflow templates");
  console.log(
    "  update     Install missing templates and update outdated templates",
  );
  console.log("  validate   Validate installed workflow templates\n");
  console.log("Options:");
  console.log("  --json      Print machine-readable JSON output");
  console.log("  --dry-run   Show what install/update would write");
  console.log("  --help, -h  Show this help message\n");
  console.log("Examples:");
  console.log("  dn workflows list");
  console.log("  dn workflows install");
  console.log("  dn workflows validate --json");
}

function parseConfig(
  args: string[],
): { config: WorkflowCommandConfig; rest: string[] } {
  const rest: string[] = [];
  const config: WorkflowCommandConfig = {
    json: false,
    dryRun: false,
  };

  for (const arg of args) {
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

/**
 * Handle `dn workflows` subcommands.
 */
export async function handleWorkflows(args: string[]): Promise<void> {
  const { config, rest } = parseConfig(args);
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
    const results = await installWorkflowTemplates(repoRoot, {
      dryRun: config.dryRun,
      updateExisting: false,
    });
    config.json
      ? printJson({ dry_run: config.dryRun, results })
      : printWriteResults(results, "install");
    return;
  }

  if (subcommand === "update") {
    const results = await updateWorkflowTemplates(repoRoot, {
      dryRun: config.dryRun,
    });
    config.json
      ? printJson({ dry_run: config.dryRun, results })
      : printWriteResults(results, "update");
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
  await handleWorkflows(["install", ...args]);
}
