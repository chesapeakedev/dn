// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { setUnattended } from "../github/output.ts";
import { AGENT_FAILURE_TRUNCATE_CHARS } from "../github/progress.ts";
import {
  extractLandJson,
  LAND_JSON_PARSE_RECOVERY,
  parseCommitPlan,
} from "./parse.ts";

Deno.test("parseCommitPlan accepts null body", () => {
  const plan = parseCommitPlan(
    [
      {
        files: ["a.ts"],
        summary: "feat: add a",
        body: null,
      },
      {
        files: ["b.ts"],
        summary: "test: add b",
      },
    ],
    ["a.ts", "b.ts"],
  );

  assertEquals(plan.length, 2);
  assertEquals(plan[0].body, undefined);
  assertEquals(plan[1].body, undefined);
});

Deno.test("parseCommitPlan rejects empty body string as undefined", () => {
  const plan = parseCommitPlan(
    [
      {
        files: ["a.ts"],
        summary: "feat: add a",
        body: "   ",
      },
    ],
    ["a.ts"],
  );

  assertEquals(plan[0].body, undefined);
});

Deno.test("extractLandJson parses fenced JSON arrays", () => {
  const parsed = extractLandJson(
    'Here:\n```json\n[{"files":["a.ts"],"summary":"feat: a"}]\n```\n',
  );
  assertEquals(parsed, [{ files: ["a.ts"], summary: "feat: a" }]);
});

Deno.test("extractLandJson attended prose failure includes full Got dump", () => {
  setUnattended(false);
  const prose =
    "Looks like you're reviewing a land prompt with the full diff for the denoise-task implementation. What would you like me to do with this?";
  try {
    const err = assertThrows(
      () => extractLandJson(prose),
      Error,
    );
    assertEquals(
      err.message.includes(
        "Land agent did not return a valid commit-plan JSON array.",
      ),
      true,
    );
    assertEquals(err.message.includes("Got (truncated):"), false);
    assertEquals(err.message.includes("Got:"), true);
    assertEquals(err.message.includes(prose), true);
    assertEquals(err.message.includes(LAND_JSON_PARSE_RECOVERY), true);
  } finally {
    setUnattended(false);
  }
});

Deno.test("extractLandJson unattended prose failure truncates Got dump", () => {
  setUnattended(true);
  const prose = "Looks like ".repeat(80);
  try {
    const err = assertThrows(
      () => extractLandJson(prose),
      Error,
    );
    assertEquals(err.message.includes("Got (truncated):"), true);
    assertEquals(err.message.includes("…"), true);
    assertEquals(err.message.includes(prose), false);
    assertEquals(err.message.includes(LAND_JSON_PARSE_RECOVERY), true);
    assertEquals(
      err.message.includes(
        prose.trim().slice(0, AGENT_FAILURE_TRUNCATE_CHARS),
      ),
      true,
    );
  } finally {
    setUnattended(false);
  }
});
