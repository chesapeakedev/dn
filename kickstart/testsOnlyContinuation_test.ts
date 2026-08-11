// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { setUnattended } from "../sdk/github/output.ts";
import { parseImplementPhaseResult } from "./implementResult.ts";
import {
  mergeTestsOnlySteering,
  shouldOfferTestsOnlyContinuation,
  TESTS_ONLY_STEERING_PROMPT,
} from "./testsOnlyContinuation.ts";

function testsOnlyResult() {
  return parseImplementPhaseResult({
    schema_version: "1.0",
    status: "incomplete",
    summary: "Only tests left.",
    unfinished_tasks: [{
      description: "Add coverage",
      work_kind: "tests",
      suggested_action: "rerun_loop",
    }],
    human_actions: [],
    recommendation: "rerun_loop",
  });
}

Deno.test("shouldOfferTestsOnlyContinuation is false when unattended", () => {
  setUnattended(true);
  try {
    assertEquals(shouldOfferTestsOnlyContinuation(testsOnlyResult()), false);
  } finally {
    setUnattended(false);
  }
});

Deno.test("shouldOfferTestsOnlyContinuation is true when attended and tests-only", () => {
  setUnattended(false);
  try {
    assertEquals(shouldOfferTestsOnlyContinuation(testsOnlyResult()), true);
    assertEquals(shouldOfferTestsOnlyContinuation(null), false);
  } finally {
    setUnattended(false);
  }
});

Deno.test("mergeTestsOnlySteering prepends tests-only guidance", () => {
  assertEquals(mergeTestsOnlySteering(), TESTS_ONLY_STEERING_PROMPT);
  assertEquals(
    mergeTestsOnlySteering("Prefer Deno.test helpers."),
    `${TESTS_ONLY_STEERING_PROMPT}\n\nPrefer Deno.test helpers.`,
  );
});
