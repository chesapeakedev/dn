// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { parseReviewArgs } from "./review.ts";
import { reviewFailureDocument } from "../sdk/github/reviewCliError.ts";

Deno.test("parseReviewArgs accepts flags and PR URL", () => {
  const parsed = parseReviewArgs(
    ["https://github.com/o/r/pull/1", "--json", "--no-agent"],
    null,
  );
  assertEquals(parsed, {
    help: false,
    json: true,
    noAgent: true,
    prUrl: "https://github.com/o/r/pull/1",
    agent: null,
  });
});

Deno.test("parseReviewArgs rejects mutation flags", () => {
  assertThrows(
    () =>
      parseReviewArgs(
        ["https://github.com/o/r/pull/1", "--approve"],
        null,
      ),
    Error,
    "read-only",
  );
});

Deno.test("parseReviewArgs rejects duplicate positional URLs", () => {
  assertThrows(
    () =>
      parseReviewArgs(
        [
          "https://github.com/o/r/pull/1",
          "https://github.com/o/r/pull/2",
        ],
        null,
      ),
    Error,
    "exactly one",
  );
});

Deno.test("reviewFailureDocument classifies bare PR numbers", () => {
  const doc = reviewFailureDocument(
    new Error(
      "Expected a full GitHub issue or pull request URL. Bare numbers are only supported by dn kickstart.",
    ),
  );
  assertEquals(doc.ok, false);
  assertEquals(doc.error.code, "invalid-reference");
  assertEquals(doc.schemaVersion, "1.0");
});
