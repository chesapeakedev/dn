// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  resolvePlanName,
  sanitizePlanName,
  suggestPlanName,
} from "./planName.ts";
import { setUnattended } from "./output.ts";

Deno.test("sanitizePlanName replaces path separators", () => {
  assertEquals(
    sanitizePlanName("kickstart/issue_12_add-dark"),
    "kickstart-issue_12_add-dark",
  );
});

Deno.test("suggestPlanName prefers title slug over branch", () => {
  assertEquals(
    suggestPlanName({
      issueTitle: "Add dark mode support",
      branchName: "kickstart/issue_12_add-dark-mode-support",
    }),
    "add-dark",
  );
});

Deno.test("suggestPlanName falls back to sanitized branch", () => {
  assertEquals(
    suggestPlanName({
      branchName: "kickstart/issue_9_fix",
    }),
    "kickstart-issue_9_fix",
  );
});

Deno.test("resolvePlanName uses savedPlanName when set", () => {
  setUnattended(true);
  try {
    assertEquals(
      resolvePlanName({
        savedPlanName: "explicit",
        issueTitle: "Add dark mode",
      }),
      "explicit",
    );
  } finally {
    setUnattended(false);
  }
});

Deno.test("resolvePlanName auto-derives from title when unattended", () => {
  setUnattended(true);
  try {
    assertEquals(
      resolvePlanName({
        savedPlanName: null,
        issueTitle: "Plan name is required",
        branchName: "kickstart/issue_1_plan-name-is-required",
      }),
      "plan-name",
    );
  } finally {
    setUnattended(false);
  }
});

Deno.test("resolvePlanName throws when unattended without title or branch", () => {
  setUnattended(true);
  try {
    assertThrows(
      () =>
        resolvePlanName({
          savedPlanName: null,
        }),
      Error,
      "Plan name is required in unattended mode",
    );
  } finally {
    setUnattended(false);
  }
});
