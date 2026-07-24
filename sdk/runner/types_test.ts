// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
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
