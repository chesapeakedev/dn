// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, fromFileUrl, join } from "@std/path";
import { validateWorkflowAgentSetup } from "./agentConfig.ts";

const WORKFLOW_ROOT = dirname(dirname(dirname(fromFileUrl(import.meta.url))));
const MANIFEST_PATH = join(
  WORKFLOW_ROOT,
  "templates",
  "workflows",
  "manifest.json",
);

/**
 * Supported workflow permission levels in GitHub Actions templates.
 */
export type WorkflowPermission = "read" | "write";

/**
 * Machine-readable payload field contract for a dispatch workflow.
 */
export interface WorkflowPayloadContract {
  /** Required client_payload keys. */
  required: string[];
  /** Optional client_payload keys. */
  optional: string[];
}

/**
 * Supported trigger modes for a canonical dn workflow template.
 */
export interface WorkflowTriggerContract {
  /** repository_dispatch event types accepted by the workflow. */
  repository_dispatch: string[];
  /** Whether the workflow accepts manual workflow_dispatch runs. */
  workflow_dispatch?: boolean;
  /** Cron schedules accepted by the workflow. */
  schedule?: string[];
  /** Legacy issue labels that map to related behavior. */
  labels: string[];
  /** Legacy issue comments that map to related behavior. */
  comments: string[];
}

/**
 * One canonical workflow template entry from templates/workflows/manifest.json.
 */
export interface WorkflowTemplateManifestEntry {
  /** Stable action id, also used as repository_dispatch event name. */
  id: string;
  /** Template contract version. */
  version: string;
  /** Path to the source template within the dn package. */
  source_path: string;
  /** Target path when installed into a consumer repository. */
  install_path: string;
  /** sha256 checksum of the source template, prefixed with sha256:. */
  checksum: string;
  /** Latest compatible version for update checks. */
  latest_version: string;
  /** Whether this template should no longer be installed by default. */
  deprecated: boolean;
  /** Optional human-readable deprecation guidance. */
  deprecation_message: string | null;
  /** Minimum dn version expected by the template. */
  minimum_dn_version: string;
  /** Required GitHub Actions permissions. */
  permissions: Record<string, WorkflowPermission>;
  /**
   * Repository secrets the workflow expects the user to configure.
   * Do not list `GITHUB_TOKEN`: Actions injects that automatically (see
   * `permissions`); integrators that diff this list against repo secrets would
   * falsely report it as missing.
   */
  required_secrets: string[];
  /** Optional secrets that unlock agent-specific behavior. */
  optional_secrets: string[];
  /** Supported trigger modes. */
  triggers: WorkflowTriggerContract;
  /** client_payload schema version. */
  payload_schema_version: string;
  /** Required and optional client_payload keys. */
  payload: WorkflowPayloadContract;
  /** Additional compatibility guidance for integrators. */
  compatibility_notes: string;
}

/**
 * Canonical workflow template manifest.
 */
export interface WorkflowManifest {
  /** Manifest schema version. */
  schema_version: string;
  /** Template entries shipped by dn. */
  templates: WorkflowTemplateManifestEntry[];
}

/**
 * Status for a workflow template in a consumer repository.
 */
export type WorkflowInstallStatus = "missing" | "current" | "outdated";

/**
 * Installed-template comparison result.
 */
export interface WorkflowTemplateStatus {
  /** Template metadata from the manifest. */
  template: WorkflowTemplateManifestEntry;
  /** Whether the consumer repo has the latest template content. */
  status: WorkflowInstallStatus;
  /** Installed file checksum when the file exists. */
  installed_checksum: string | null;
  /** Expected source checksum from the manifest. */
  expected_checksum: string;
  /** Absolute installed path in the consumer repo. */
  install_path: string;
}

/**
 * Result for install or update operations.
 */
export interface WorkflowWriteResult {
  /** Template metadata from the manifest. */
  template: WorkflowTemplateManifestEntry;
  /** Absolute path that was or would be written. */
  install_path: string;
  /** Whether the command wrote the file. */
  written: boolean;
  /** Whether this was a dry run. */
  dry_run: boolean;
  /** Status before the operation. */
  previous_status: WorkflowInstallStatus;
}

/**
 * Validation warning for an installed workflow template.
 */
export interface WorkflowValidationWarning {
  /** Stable warning code for machine consumers. */
  code: string;
  /** Template id associated with the warning. */
  template_id: string;
  /** Human-readable warning message. */
  message: string;
}

/**
 * Validation result for canonical workflow setup.
 */
export interface WorkflowValidationResult {
  /** Per-template status results. */
  templates: WorkflowTemplateStatus[];
  /** Non-fatal warnings, including missing/outdated templates. */
  warnings: WorkflowValidationWarning[];
  /** True when every template is current and no permission warnings exist. */
  ok: boolean;
}

/**
 * Load the canonical workflow manifest shipped with dn.
 */
export async function loadWorkflowManifest(): Promise<WorkflowManifest> {
  const content = await Deno.readTextFile(MANIFEST_PATH);
  const parsed = JSON.parse(content) as WorkflowManifest;
  validateWorkflowManifest(parsed);
  return parsed;
}

/**
 * Validate the high-level manifest shape.
 *
 * This intentionally checks only structural requirements that dn depends on at
 * runtime. Payload details remain declarative so clients can evolve against the
 * manifest without requiring code changes here.
 */
export function validateWorkflowManifest(manifest: WorkflowManifest): void {
  if (manifest.schema_version !== "1.0") {
    throw new Error(
      `Unsupported workflow manifest schema: ${manifest.schema_version}`,
    );
  }

  const ids = new Set<string>();
  for (const template of manifest.templates) {
    if (ids.has(template.id)) {
      throw new Error(`Duplicate workflow template id: ${template.id}`);
    }
    ids.add(template.id);

    if (!template.source_path || !template.install_path) {
      throw new Error(`Workflow template ${template.id} is missing paths`);
    }
    if (!template.checksum.startsWith("sha256:")) {
      throw new Error(
        `Workflow template ${template.id} checksum must be sha256`,
      );
    }
    const hasDispatch = template.triggers.repository_dispatch.length > 0;
    const hasManual = template.triggers.workflow_dispatch === true;
    const hasSchedule = (template.triggers.schedule?.length ?? 0) > 0;
    if (!hasDispatch && !hasManual && !hasSchedule) {
      throw new Error(
        `Workflow template ${template.id} needs at least one trigger`,
      );
    }
  }
}

/**
 * Read a canonical workflow template by manifest entry.
 */
export async function readWorkflowTemplate(
  template: WorkflowTemplateManifestEntry,
): Promise<string> {
  return await Deno.readTextFile(resolveTemplatePath(template));
}

/**
 * Compute a sha256 checksum string compatible with manifest checksums.
 */
export async function computeSha256(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/**
 * Return installed-template status for every canonical template.
 */
export async function listWorkflowStatuses(
  repoRoot: string,
  manifest?: WorkflowManifest,
): Promise<WorkflowTemplateStatus[]> {
  const resolvedManifest = manifest ?? await loadWorkflowManifest();
  return await Promise.all(
    resolvedManifest.templates.map((template) =>
      getWorkflowTemplateStatus(repoRoot, template)
    ),
  );
}

/**
 * Install all missing or outdated canonical workflow templates.
 */
export async function installWorkflowTemplates(
  repoRoot: string,
  options: { dryRun?: boolean; updateExisting?: boolean } = {},
  manifest?: WorkflowManifest,
): Promise<WorkflowWriteResult[]> {
  const resolvedManifest = manifest ?? await loadWorkflowManifest();
  const results: WorkflowWriteResult[] = [];

  for (const template of resolvedManifest.templates) {
    const status = await getWorkflowTemplateStatus(repoRoot, template);
    if (status.status === "current") {
      continue;
    }
    if (status.status === "outdated" && options.updateExisting !== true) {
      continue;
    }

    const content = await readWorkflowTemplate(template);
    if (options.dryRun !== true) {
      await Deno.mkdir(dirname(status.install_path), { recursive: true });
      await Deno.writeTextFile(status.install_path, content);
    }

    results.push({
      template,
      install_path: status.install_path,
      written: options.dryRun !== true,
      dry_run: options.dryRun === true,
      previous_status: status.status,
    });
  }

  return results;
}

/**
 * Update all installed canonical templates that differ from the shipped source.
 */
export async function updateWorkflowTemplates(
  repoRoot: string,
  options: { dryRun?: boolean } = {},
  manifest?: WorkflowManifest,
): Promise<WorkflowWriteResult[]> {
  const resolvedManifest = manifest ?? await loadWorkflowManifest();
  return await installWorkflowTemplates(
    repoRoot,
    { dryRun: options.dryRun, updateExisting: true },
    resolvedManifest,
  );
}

/**
 * Validate canonical workflow installation state.
 */
export async function validateWorkflowInstallation(
  repoRoot: string,
  manifest?: WorkflowManifest,
): Promise<WorkflowValidationResult> {
  const resolvedManifest = manifest ?? await loadWorkflowManifest();
  const templates = await listWorkflowStatuses(repoRoot, resolvedManifest);
  const warnings: WorkflowValidationWarning[] = [];

  for (const status of templates) {
    if (status.status === "missing") {
      warnings.push({
        code: "template_missing",
        template_id: status.template.id,
        message: `${status.template.install_path} is not installed`,
      });
      continue;
    }

    if (status.status === "outdated") {
      warnings.push({
        code: "template_outdated",
        template_id: status.template.id,
        message:
          `${status.template.install_path} differs from canonical template`,
      });
    }

    const content = await Deno.readTextFile(status.install_path);
    for (
      const [permission, level] of Object.entries(status.template.permissions)
    ) {
      if (!content.includes(`${permission}: ${level}`)) {
        warnings.push({
          code: "permission_missing",
          template_id: status.template.id,
          message:
            `${status.template.install_path} should include permission ${permission}: ${level}`,
        });
      }
    }
  }

  for (const warning of await validateWorkflowAgentSetup(repoRoot)) {
    warnings.push({
      code: warning.code,
      template_id: "dn.agent",
      message: warning.message,
    });
  }

  const blockingWarnings = warnings.filter((warning) =>
    warning.code !== "agent_secret_check_skipped"
  );

  return {
    templates,
    warnings,
    ok: blockingWarnings.length === 0,
  };
}

async function getWorkflowTemplateStatus(
  repoRoot: string,
  template: WorkflowTemplateManifestEntry,
): Promise<WorkflowTemplateStatus> {
  const installPath = join(repoRoot, template.install_path);

  try {
    const installed = await Deno.readTextFile(installPath);
    const installedChecksum = await computeSha256(installed);
    return {
      template,
      status: installedChecksum === template.checksum ? "current" : "outdated",
      installed_checksum: installedChecksum,
      expected_checksum: template.checksum,
      install_path: installPath,
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {
        template,
        status: "missing",
        installed_checksum: null,
        expected_checksum: template.checksum,
        install_path: installPath,
      };
    }
    throw error;
  }
}

function resolveTemplatePath(template: WorkflowTemplateManifestEntry): string {
  return join(WORKFLOW_ROOT, template.source_path);
}

export {
  extractDispatchPayloadError,
  repositoryDispatchEventType,
  resolveManifestTemplate,
  validateDispatchPayload,
} from "./dispatch.ts";
export type {
  RepositoryDispatchClientPayload,
  WorkflowRunDispatchMode,
} from "./dispatch.ts";
export {
  DN_CONFIG_REL_PATH,
  DN_INSTALL_SCRIPT_REL_PATH,
  extractAgentFlag,
  formatDnWorkflowAgentConfig,
  installWorkflowSupport,
  parseDnWorkflowAgentConfig,
  readDnWorkflowAgentConfig,
  requiredSecretForAgent,
  secretSetupHint,
  validateWorkflowAgentSetup,
} from "./agentConfig.ts";
export type {
  DnWorkflowAgentConfig,
  WorkflowSupportWriteResult,
} from "./agentConfig.ts";
