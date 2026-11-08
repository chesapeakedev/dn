// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertThrows } from "@std/assert";
import { rejectBareGitHubNumber } from "./githubReferencePolicy.ts";
import { normalizePullRequestUrl } from "./pullRequestReference.ts";

Deno.test("rejectBareGitHubNumber rejects issue-style numbers", () => {
  assertThrows(() => rejectBareGitHubNumber("517"), Error, "dn kickstart");
  assertThrows(() => rejectBareGitHubNumber("#517"), Error, "dn kickstart");
});

Deno.test("normalizePullRequestUrl rejects bare numbers", () => {
  assertThrows(
    () => normalizePullRequestUrl("42"),
    Error,
    "dn kickstart",
  );
});
