// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type DenoiseTaskDocument,
  denoiseTaskToMarkdown,
  repositoryFromDenoiseTask,
  repositoryFromIssueUrl,
  type RunnerJob,
  validateRunnerJob,
} from "./types.ts";

function validJob(): RunnerJob {
  return {
    protocol_version: "1.0",
    id: "job-1",
    invocation_id: "invocation-1",
    runner_id: "runner-1",
    repository: "chesapeakedev/dn",
    operation: {
      type: "kickstart",
      issue_url: "https://github.com/chesapeakedev/dn/issues/213",
      publish: "pr",
      agent: "codex",
    },
    created_at: "2026-07-23T12:00:00.000Z",
    queued_until: "2026-07-24T12:00:00.000Z",
    lease: {
      id: "lease-1",
      expires_at: "2026-07-23T12:01:00.000Z",
      cancel_requested: false,
    },
  };
}

Deno.test("repositoryFromIssueUrl accepts only canonical GitHub issue URLs", () => {
  assertEquals(
    repositoryFromIssueUrl("https://github.com/chesapeakedev/dn/issues/213"),
    "chesapeakedev/dn",
  );
  assertThrows(
    () => repositoryFromIssueUrl("https://example.com/owner/repo/issues/1"),
    Error,
    "Expected https://github.com",
  );
  assertThrows(
    () => repositoryFromIssueUrl("https://github.com/owner/repo/pulls/1"),
    Error,
    "Expected https://github.com",
  );
});

Deno.test("validateRunnerJob accepts a typed job for the paired runner", () => {
  assertEquals(validateRunnerJob(validJob(), "runner-1"), validJob());
});

Deno.test("validateRunnerJob rejects another runner and repository", () => {
  assertThrows(
    () => validateRunnerJob(validJob(), "runner-2"),
    Error,
    "different device",
  );
  const job = validJob();
  job.repository = "chesapeakedev/other";
  assertThrows(
    () => validateRunnerJob(job),
    Error,
    "belongs to chesapeakedev/dn",
  );
});

Deno.test("validateRunnerJob rejects generic remote execution fields", () => {
  const job = {
    ...validJob(),
    operation: {
      type: "shell",
      argv: ["sh", "-c", "echo unsafe"],
    },
  } as unknown as RunnerJob;
  assertThrows(
    () => validateRunnerJob(job),
    Error,
    "only permits kickstart",
  );
});

for (const publish of ["none", "direct"] as const) {
  Deno.test(`validateRunnerJob rejects ${publish} publishing`, () => {
    const job = validJob();
    job.operation.publish = publish;
    assertThrows(
      () => validateRunnerJob(job),
      Error,
      "require PR publishing",
    );
  });
}

Deno.test("validateRunnerJob rejects an unsupported protocol version", () => {
  const job = {
    ...validJob(),
    protocol_version: "2.0",
  } as unknown as RunnerJob;
  assertThrows(
    () => validateRunnerJob(job),
    Error,
    'Unsupported runner protocol "2.0"',
  );
});

function denoiseTaskDoc(): DenoiseTaskDocument {
  return {
    schema_version: "1.0",
    id: "task-1",
    title: "Add dark mode",
    body: "Users need a dark mode toggle.",
    repository: "chesapeakedev/dn",
    labels: ["enhancement", "ui"],
    acceptance_criteria: [
      "Dark mode toggle in settings",
      "CSS variables for theme",
    ],
    created_at: "2026-07-23T12:00:00.000Z",
  };
}

function denoiseTaskJob(): RunnerJob {
  return {
    protocol_version: "1.0",
    id: "job-denoise-1",
    invocation_id: "invocation-denoise-1",
    runner_id: "runner-1",
    repository: "chesapeakedev/dn",
    operation: {
      type: "denoise-task",
      task_document: denoiseTaskDoc(),
      publish: "pr",
      agent: "codex",
    },
    created_at: "2026-07-23T12:00:00.000Z",
    queued_until: "2026-07-24T12:00:00.000Z",
    lease: {
      id: "lease-denoise-1",
      expires_at: "2026-07-23T12:01:00.000Z",
      cancel_requested: false,
    },
  };
}

Deno.test("denoiseTaskToMarkdown includes title and body", () => {
  const md = denoiseTaskToMarkdown(denoiseTaskDoc());
  assert(md.startsWith("# Add dark mode"));
  assert(md.includes("Users need a dark mode toggle."));
});

Deno.test("denoiseTaskToMarkdown includes acceptance criteria and labels", () => {
  const md = denoiseTaskToMarkdown(denoiseTaskDoc());
  assert(md.includes("## Acceptance Criteria"));
  assert(md.includes("- [ ] Dark mode toggle in settings"));
  assert(md.includes("- [ ] CSS variables for theme"));
  assert(md.includes("## Labels"));
  assert(md.includes("enhancement, ui"));
});

Deno.test("denoiseTaskToMarkdown works without optional fields", () => {
  const md = denoiseTaskToMarkdown({
    schema_version: "1.0",
    id: "minimal",
    title: "Minimal task",
    body: "Just a body.",
    created_at: "2026-07-23T12:00:00.000Z",
  });
  assert(md.startsWith("# Minimal task"));
  assert(!md.includes("## Acceptance Criteria"));
});

Deno.test("repositoryFromDenoiseTask extracts repository slug", () => {
  assertEquals(
    repositoryFromDenoiseTask(denoiseTaskDoc()),
    "chesapeakedev/dn",
  );
});

Deno.test("repositoryFromDenoiseTask returns null when absent", () => {
  assertEquals(
    repositoryFromDenoiseTask({
      schema_version: "1.0",
      id: "no-repo",
      title: "No repo",
      body: "No repo body.",
      created_at: "2026-07-23T12:00:00.000Z",
    }),
    null,
  );
});

Deno.test("validateRunnerJob accepts a denoise-task job", () => {
  assertEquals(
    validateRunnerJob(denoiseTaskJob(), "runner-1"),
    denoiseTaskJob(),
  );
});

Deno.test("validateRunnerJob rejects denoise-task with incomplete document", () => {
  const job = denoiseTaskJob();
  (job.operation as RunnerJob["operation"] & {
    task_document: DenoiseTaskDocument;
  }).task_document = {
    schema_version: "1.0",
    id: "",
    title: "",
    body: "",
    created_at: "2026-07-23T12:00:00.000Z",
  };
  assertThrows(
    () => validateRunnerJob(job),
    Error,
    "incomplete task document",
  );
});

Deno.test("validateRunnerJob rejects denoise-task with mismatched repository", () => {
  const job = denoiseTaskJob();
  job.repository = "chesapeakedev/other";
  assertThrows(
    () => validateRunnerJob(job),
    Error,
    "belongs to chesapeakedev/dn",
  );
});
