// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  extractImplementResultFromStdout,
  parseImplementPhaseResult,
} from "./implementResult.ts";

Deno.test("parseImplementPhaseResult accepts a complete document", () => {
  const result = parseImplementPhaseResult({
    schema_version: "1.0",
    status: "needs_human",
    summary: "Feature work done; tests need a human runner.",
    unfinished_tasks: [{
      description: "Wire or run Void unit tests",
      criterion: "Pairing and reconnect handling have deterministic coverage",
      reason: "void-ui has no single npm test script",
      suggested_action: "human_action",
    }],
    human_actions: [{
      description: "Run the Deno unit tests for void-ui runner modules",
      reason: "No Makefile/npm test target exists yet",
      command: "deno test -A void-ui/src/lib/runner*.test.ts",
    }],
    recommendation: "human_action",
  });

  assertEquals(result.status, "needs_human");
  assertEquals(result.recommendation, "human_action");
  assertEquals(result.unfinished_tasks.length, 1);
  assertEquals(result.human_actions[0]?.command?.includes("deno test"), true);
});

Deno.test("parseImplementPhaseResult rejects invalid recommendation", () => {
  assertThrows(
    () =>
      parseImplementPhaseResult({
        schema_version: "1.0",
        status: "incomplete",
        summary: "x",
        unfinished_tasks: [],
        human_actions: [],
        recommendation: "maybe",
      }),
    TypeError,
    "recommendation",
  );
});

Deno.test("extractImplementResultFromStdout reads labeled fence", () => {
  const stdout = `
Implementation notes...

\`\`\`json dn-implement-result
{
  "schema_version": "1.0",
  "status": "incomplete",
  "summary": "Two criteria remain.",
  "unfinished_tasks": [
    { "description": "Add pairing parser tests" }
  ],
  "human_actions": [],
  "recommendation": "rerun_loop"
}
\`\`\`
`;

  const result = extractImplementResultFromStdout(stdout);
  assertEquals(result?.status, "incomplete");
  assertEquals(
    result?.unfinished_tasks[0]?.description,
    "Add pairing parser tests",
  );
  assertEquals(result?.recommendation, "rerun_loop");
});

Deno.test("extractImplementResultFromStdout returns null without fence", () => {
  assertEquals(extractImplementResultFromStdout("no result here"), null);
});
