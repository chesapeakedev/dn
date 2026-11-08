// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { resolveIssueUrlInput } from "../sdk/github/issue.ts";
import { parseRepoRef, resolveIssueRef } from "./issue.ts";

Deno.test("resolveIssueUrlInput rejects bare numbers by default", async () => {
  await assertRejects(
    () => resolveIssueUrlInput("99"),
    Error,
    "dn kickstart",
  );
});

Deno.test("parseRepoRef accepts owner/repo", () => {
  assertEquals(parseRepoRef("acme/platform"), {
    owner: "acme",
    repo: "platform",
  });
});

Deno.test("parseRepoRef rejects malformed repositories", () => {
  assertEquals(parseRepoRef("acme"), null);
  assertEquals(parseRepoRef("acme/platform/extra"), null);
  assertEquals(parseRepoRef("/platform"), null);
  assertEquals(parseRepoRef("acme/"), null);
});

Deno.test("resolveIssueRef rejects bare number refs", async () => {
  await assertRejects(
    () =>
      resolveIssueRef("123", {
        owner: "public-owner",
        repo: "public-repo",
      }),
    Error,
    "dn kickstart",
  );
});

Deno.test("resolveIssueRef lets full URLs choose their repository", async () => {
  const resolved = await resolveIssueRef(
    "https://github.com/url-owner/url-repo/issues/456",
    {
      owner: "override-owner",
      repo: "override-repo",
    },
  );

  assertEquals(resolved, {
    owner: "url-owner",
    repo: "url-repo",
    number: 456,
  });
});
