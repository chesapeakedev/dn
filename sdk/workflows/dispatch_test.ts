// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  extractDispatchPayloadError,
  resolveManifestTemplate,
  validateDispatchPayload,
} from "./dispatch.ts";
import type { WorkflowManifest } from "./mod.ts";

const manifest: WorkflowManifest = {
  schema_version: "1.0",
  templates: [
    {
      id: "dn.init_stack",
      version: "1.0.0",
      source_path: "templates/workflows/dn-init-stack.yml",
      install_path: ".github/workflows/dn-init-stack.yml",
      checksum: "sha256:abc",
      latest_version: "1.0.0",
      deprecated: false,
      deprecation_message: null,
      minimum_dn_version: "0.0.21",
      permissions: { contents: "write", issues: "write" },
      required_secrets: [],
      optional_secrets: [],
      triggers: {
        repository_dispatch: ["dn.init_stack"],
        labels: [],
        comments: [],
      },
      payload_schema_version: "1.0",
      payload: {
        required: ["schema_version", "dispatch_id", "milestone"],
        optional: ["refresh"],
      },
      compatibility_notes: "",
    },
    {
      id: "dn.prep_issue_plan",
      version: "1.0.0",
      source_path: "templates/workflows/dn-prep-issue-plan.yml",
      install_path: ".github/workflows/dn-prep-issue-plan.yml",
      checksum: "sha256:def",
      latest_version: "1.0.0",
      deprecated: false,
      deprecation_message: null,
      minimum_dn_version: "0.0.21",
      permissions: { contents: "write", issues: "write" },
      required_secrets: [],
      optional_secrets: [],
      triggers: {
        repository_dispatch: ["dn.prep_issue_plan"],
        labels: [],
        comments: [],
      },
      payload_schema_version: "1.0",
      payload: {
        required: ["schema_version", "dispatch_id"],
        optional: ["issue_url", "issue_number", "plan_name"],
      },
      compatibility_notes: "",
    },
  ],
};

Deno.test("resolveManifestTemplate matches id and filenames", () => {
  assertEquals(
    resolveManifestTemplate("dn.init_stack", manifest)?.id,
    "dn.init_stack",
  );
  assertEquals(
    resolveManifestTemplate("dn-init-stack.yml", manifest)?.id,
    "dn.init_stack",
  );
  assertEquals(
    resolveManifestTemplate("dn-prep-issue-plan.yml", manifest)?.id,
    "dn.prep_issue_plan",
  );
  assertEquals(resolveManifestTemplate("release.yml", manifest), undefined);
});

Deno.test("extractDispatchPayloadError validates init_stack payload", () => {
  assertEquals(
    extractDispatchPayloadError(manifest.templates[0], {
      schema_version: "1.0",
      dispatch_id: "abc",
    }),
    "client_payload.milestone is required",
  );

  assertEquals(
    extractDispatchPayloadError(manifest.templates[0], {
      schema_version: "2.0",
      dispatch_id: "abc",
      milestone: "1",
    }),
    "client_payload.schema_version must be 1.0",
  );

  assertEquals(
    extractDispatchPayloadError(manifest.templates[0], {
      schema_version: "1.0",
      milestone: "1",
    }),
    "client_payload.dispatch_id is required",
  );
});

Deno.test("extractDispatchPayloadError validates issue selector exclusivity", () => {
  const template = manifest.templates[1];
  assertEquals(
    extractDispatchPayloadError(template, {
      schema_version: "1.0",
      dispatch_id: "abc",
    }),
    "Provide exactly one of client_payload.issue_url or client_payload.issue_number",
  );

  assertEquals(
    extractDispatchPayloadError(template, {
      schema_version: "1.0",
      dispatch_id: "abc",
      issue_url: "https://github.com/o/r/issues/1",
      issue_number: 1,
    }),
    "Provide exactly one of client_payload.issue_url or client_payload.issue_number",
  );

  assertEquals(
    extractDispatchPayloadError(template, {
      schema_version: "1.0",
      dispatch_id: "abc",
      issue_number: 1,
    }),
    undefined,
  );
});

Deno.test("validateDispatchPayload throws on invalid payload", () => {
  let threw = false;
  try {
    validateDispatchPayload(manifest.templates[0], {
      schema_version: "1.0",
      dispatch_id: "abc",
    });
  } catch (error) {
    threw = true;
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "client_payload.milestone is required",
    );
  }
  assertEquals(threw, true);
});
