// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  clearImplementResult,
  extractImplementResultFromStdout,
  IMPLEMENT_RESULT_RELATIVE_PATH,
  onlyTestsRemaining,
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

Deno.test("parseImplementPhaseResult accepts work_kind on unfinished tasks", () => {
  const result = parseImplementPhaseResult({
    schema_version: "1.0",
    status: "incomplete",
    summary: "Feature done; tests remain.",
    unfinished_tasks: [{
      description: "Add parser coverage",
      criterion: "Automated tests cover parsing",
      reason: "Deferred to a follow-up pass",
      suggested_action: "rerun_loop",
      work_kind: "tests",
    }],
    human_actions: [],
    recommendation: "rerun_loop",
  });
  assertEquals(result.unfinished_tasks[0]?.work_kind, "tests");
});

Deno.test("parseImplementPhaseResult rejects invalid work_kind", () => {
  assertThrows(
    () =>
      parseImplementPhaseResult({
        schema_version: "1.0",
        status: "incomplete",
        summary: "x",
        unfinished_tasks: [{
          description: "Add tests",
          work_kind: "qa",
        }],
        human_actions: [],
        recommendation: "rerun_loop",
      }),
    TypeError,
    "work_kind",
  );
});

Deno.test("onlyTestsRemaining is true for tests-only rerun_loop leftovers", () => {
  const result = parseImplementPhaseResult({
    schema_version: "1.0",
    status: "incomplete",
    summary: "Only tests left.",
    unfinished_tasks: [
      { description: "Unit tests", work_kind: "tests" },
      { description: "Integration tests", work_kind: "tests" },
    ],
    human_actions: [],
    recommendation: "rerun_loop",
  });
  assertEquals(onlyTestsRemaining(result), true);
});

Deno.test("onlyTestsRemaining fails closed for mixed or missing work_kind", () => {
  const mixed = parseImplementPhaseResult({
    schema_version: "1.0",
    status: "incomplete",
    summary: "Mixed leftovers.",
    unfinished_tasks: [
      { description: "CLI flag", work_kind: "feature" },
      { description: "Unit tests", work_kind: "tests" },
    ],
    human_actions: [],
    recommendation: "rerun_loop",
  });
  assertEquals(onlyTestsRemaining(mixed), false);

  const missingKind = parseImplementPhaseResult({
    schema_version: "1.0",
    status: "incomplete",
    summary: "Missing kinds.",
    unfinished_tasks: [{ description: "Add tests" }],
    human_actions: [],
    recommendation: "rerun_loop",
  });
  assertEquals(onlyTestsRemaining(missingKind), false);
});

Deno.test("onlyTestsRemaining rejects non-rerun_loop recommendations", () => {
  const result = parseImplementPhaseResult({
    schema_version: "1.0",
    status: "incomplete",
    summary: "Tests need a human runner.",
    unfinished_tasks: [{
      description: "Run void tests",
      work_kind: "tests",
    }],
    human_actions: [],
    recommendation: "human_action",
  });
  assertEquals(onlyTestsRemaining(result), false);
});

Deno.test("extractImplementResultFromStdout returns null without fence", () => {
  assertEquals(extractImplementResultFromStdout("no result here"), null);
});

Deno.test(
  "clearImplementResult migrates a legacy .dn binary then clears the file",
  async () => {
    const root = join(
      dirname(fromFileUrl(import.meta.url)),
      "..",
      ".tmp-implement-result-clear",
    );
    await Deno.remove(root, { recursive: true }).catch(() => {});
    await Deno.mkdir(root, { recursive: true });
    const warn = console.warn;
    console.warn = () => {};
    try {
      await Deno.writeTextFile(join(root, ".dn"), "fake-binary");
      await clearImplementResult(root);
      const stateDir = await Deno.stat(join(root, ".dn"));
      assertEquals(stateDir.isDirectory, true);
      await Deno.stat(join(root, IMPLEMENT_RESULT_RELATIVE_PATH)).then(
        () => {
          throw new Error("implement-result.json should not exist");
        },
        (error) => {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        },
      );
    } finally {
      console.warn = warn;
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
