// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { basename } from "@std/path";
import type { WorkflowManifest, WorkflowTemplateManifestEntry } from "./mod.ts";

/**
 * Forced trigger mode for `dn workflows dispatch`.
 */
export type WorkflowDispatchMode = "repository" | "workflow";

/**
 * `client_payload` object for a `repository_dispatch` event.
 */
export type RepositoryDispatchClientPayload = Record<string, unknown>;

/**
 * Resolve a workflow selector to a canonical manifest template, if any.
 *
 * Matches template id, installed filename, or shipped source filename.
 */
export function resolveManifestTemplate(
  selector: string,
  manifest: WorkflowManifest,
): WorkflowTemplateManifestEntry | undefined {
  if (!selector) {
    return undefined;
  }

  const normalized = selector.toLowerCase();
  if (
    normalized === "dn.prep_issue_plan" ||
    normalized === "dn-prep-issue-plan.yml"
  ) {
    return manifest.templates.find((template) =>
      template.id === "dn.meld_issue_plan"
    );
  }
  for (const template of manifest.templates) {
    if (template.id === selector) {
      return template;
    }
    const installBase = basename(template.install_path).toLowerCase();
    const sourceBase = basename(template.source_path).toLowerCase();
    if (normalized === installBase || normalized === sourceBase) {
      return template;
    }
  }

  return undefined;
}

/**
 * Primary `repository_dispatch` event type for a manifest template.
 */
export function repositoryDispatchEventType(
  template: WorkflowTemplateManifestEntry,
): string {
  const types = template.triggers.repository_dispatch;
  if (types.length === 0) {
    throw new Error(
      `Workflow template ${template.id} has no repository_dispatch triggers`,
    );
  }
  return types[0];
}

/**
 * Return a validation error message for a dispatch payload, or `undefined` when valid.
 *
 * Messages align with validation steps in canonical workflow templates.
 */
export function extractDispatchPayloadError(
  template: WorkflowTemplateManifestEntry,
  payload: RepositoryDispatchClientPayload,
): string | undefined {
  if (payload.schema_version !== template.payload_schema_version) {
    return "client_payload.schema_version must be 1.0";
  }

  if (!payload.dispatch_id) {
    return "client_payload.dispatch_id is required";
  }

  for (const key of template.payload.required) {
    if (key === "schema_version" || key === "dispatch_id") {
      continue;
    }
    if (
      payload[key] === undefined || payload[key] === null || payload[key] === ""
    ) {
      if (key === "milestone") {
        return "client_payload.milestone is required";
      }
      return `client_payload.${key} is required`;
    }
  }

  const optional = new Set(template.payload.optional);
  for (const key of Object.keys(payload)) {
    if (
      key !== "schema_version" &&
      key !== "dispatch_id" &&
      !template.payload.required.includes(key) &&
      !optional.has(key)
    ) {
      // Allow extra keys; workflows may ignore unknown fields.
    }
  }

  const hasIssueUrl = payload.issue_url !== undefined &&
    payload.issue_url !== null &&
    payload.issue_url !== "";
  const hasIssueNumber = payload.issue_number !== undefined &&
    payload.issue_number !== null &&
    payload.issue_number !== "";

  if (
    template.id === "dn.meld_issue_plan" ||
    template.id === "dn.kickstart_issue"
  ) {
    if (hasIssueUrl === hasIssueNumber) {
      return "Provide exactly one of client_payload.issue_url or client_payload.issue_number";
    }
  }

  return undefined;
}

/**
 * Validate a repository dispatch payload for a manifest template.
 *
 * @throws Error when validation fails
 */
export function validateDispatchPayload(
  template: WorkflowTemplateManifestEntry,
  payload: RepositoryDispatchClientPayload,
): void {
  const error = extractDispatchPayloadError(template, payload);
  if (error) {
    throw new Error(error);
  }
}
