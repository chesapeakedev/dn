// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type DenoiseTaskDocument,
  denoiseTaskToMarkdown,
  isSupportedRunnerProtocol,
  parseRepositorySlug,
  repositoryFromDenoiseTask,
  repositoryFromIssueUrl,
  RUNNER_PROTOCOL_VERSION,
  type RunnerJob,
  validateDenoiseTaskDocument,
  validateRunnerJob,
} from "./types.ts";

Deno.test("isSupportedRunnerProtocol accepts the current version only", () => {
  assertEquals(isSupportedRunnerProtocol(RUNNER_PROTOCOL_VERSION), true);
  assertEquals(isSupportedRunnerProtocol("0.9"), false);
});

Deno.test("parseRepositorySlug accepts owner/repo values", () => {
  assertEquals(parseRepositorySlug("chesapeakedev/dn"), "chesapeakedev/dn");
  assertThrows(
    () => parseRepositorySlug("/tmp/checkout"),
    Error,
    "Invalid repository",
  );
});

Deno.test("repositoryFromIssueUrl accepts canonical URLs", () => {
  const url = "https://github.com/chesapeakedev/dn/issues/12";
  assertEquals(repositoryFromIssueUrl(url), "chesapeakedev/dn");
  assertThrows(
    () => repositoryFromIssueUrl("https://github.com/chesapeakedev/dn/pull/12"),
    Error,
    "Invalid issue URL",
  );
});

function validJob(): RunnerJob {
  return {
    protocol_version: "1.0",
    id: "job-1",
    invocation_id: "invocation-1",
    runner_id: "runner-1",
    repository: "chesapeakedev/dn",
    operation: {
      type: "kickstart",
      issue_url: "https://github.com/chesapeakedev/dn/issues/12",
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

Deno.test("validateRunnerJob accepts a protocol v1 kickstart job", () => {
  assertEquals(validateRunnerJob(validJob(), "runner-1"), validJob());
});

Deno.test("validateRunnerJob accepts kickstart jobs for a different execution repo", () => {
  const job = validJob();
  job.repository = "chesapeakedev/other";
  assertEquals(validateRunnerJob(job).repository, "chesapeakedev/other");
});

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
    status: "open",
    updated_at: "2026-07-23T12:00:00.000Z",
    repo_hint: "chesapeakedev/dn",
    tags: ["enhancement", "ui"],
    acceptance_criteria: [
      "Dark mode toggle in settings",
      "CSS variables for theme",
    ],
    created_at: "2026-07-23T12:00:00.000Z",
  };
}

function denoiseTaskJob(publish: "none" | "pr" | "direct" = "none"): RunnerJob {
  return {
    protocol_version: "1.0",
    id: "job-denoise-1",
    invocation_id: "invocation-denoise-1",
    runner_id: "runner-1",
    repository: "chesapeakedev/dn",
    operation: {
      type: "denoise-task",
      task_document: denoiseTaskDoc(),
      publish,
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

Deno.test("validateDenoiseTaskDocument accepts schema v1 documents", () => {
  assertEquals(validateDenoiseTaskDocument(denoiseTaskDoc()), denoiseTaskDoc());
});

Deno.test("validateDenoiseTaskDocument requires status and updated_at", () => {
  assertThrows(
    () =>
      validateDenoiseTaskDocument({
        schema_version: "1.0",
        id: "x",
        title: "t",
        body: "b",
      }),
    Error,
    "status",
  );
});

Deno.test("denoiseTaskToMarkdown includes title and body", () => {
  const md = denoiseTaskToMarkdown(denoiseTaskDoc());
  assert(md.startsWith("# Add dark mode"));
  assert(md.includes("Users need a dark mode toggle."));
});

Deno.test("denoiseTaskToMarkdown includes acceptance criteria and tags", () => {
  const md = denoiseTaskToMarkdown(denoiseTaskDoc());
  assert(md.includes("## Acceptance Criteria"));
  assert(md.includes("- [ ] Dark mode toggle in settings"));
  assert(md.includes("- [ ] CSS variables for theme"));
  assert(md.includes("## Tags"));
  assert(md.includes("enhancement, ui"));
});

Deno.test("denoiseTaskToMarkdown works without optional fields", () => {
  const md = denoiseTaskToMarkdown({
    schema_version: "1.0",
    id: "minimal",
    title: "Minimal task",
    body: "Just a body.",
    status: "open",
    updated_at: "2026-07-23T12:00:00.000Z",
  });
  assert(md.startsWith("# Minimal task"));
  assert(!md.includes("## Acceptance Criteria"));
});

Deno.test("repositoryFromDenoiseTask extracts repo_hint slug", () => {
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
      status: "open",
      updated_at: "2026-07-23T12:00:00.000Z",
    }),
    null,
  );
});

Deno.test("validateRunnerJob accepts a denoise-task job with publish none", () => {
  assertEquals(
    validateRunnerJob(denoiseTaskJob("none"), "runner-1"),
    denoiseTaskJob("none"),
  );
});

Deno.test("validateRunnerJob accepts a denoise-task job with publish pr", () => {
  assertEquals(
    validateRunnerJob(denoiseTaskJob("pr"), "runner-1"),
    denoiseTaskJob("pr"),
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
    status: "open",
    updated_at: "2026-07-23T12:00:00.000Z",
  };
  assertThrows(
    () => validateRunnerJob(job),
    Error,
    "non-empty id",
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

function landJob(planFile?: string): RunnerJob {
  return {
    protocol_version: "1.0",
    id: "job-land-1",
    invocation_id: "invocation-land-1",
    runner_id: "runner-1",
    repository: "chesapeakedev/dn",
    operation: {
      type: "land",
      issue_url: "https://github.com/chesapeakedev/dn/issues/12",
      agent: "codex",
      ...(planFile != null ? { plan_file: planFile } : {}),
    },
    created_at: "2026-07-23T12:00:00.000Z",
    queued_until: "2026-07-24T12:00:00.000Z",
    lease: {
      id: "lease-land-1",
      expires_at: "2026-07-23T12:01:00.000Z",
      cancel_requested: false,
    },
  };
}

Deno.test("validateRunnerJob accepts a land job", () => {
  assertEquals(validateRunnerJob(landJob(), "runner-1"), landJob());
});

Deno.test("validateRunnerJob accepts a land job with a repo-relative plan file", () => {
  const job = landJob("plans/foo.plan.md");
  assertEquals(validateRunnerJob(job, "runner-1"), job);
});

Deno.test("validateRunnerJob rejects a land job with a local filesystem plan path", () => {
  assertThrows(
    () => validateRunnerJob(landJob("/tmp/plans/foo.plan.md"), "runner-1"),
    Error,
    "plans/*.plan.md",
  );
});
