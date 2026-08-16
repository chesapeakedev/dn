// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  detectBlockingError,
  looksLikePromptDump,
  resolveImplementBlockingError,
} from "./detectBlockingError.ts";

const PROMPT_EXAMPLE_STDERR = `
You are running in **headless, non-interactive mode**. You MUST:
...
### Blocking Errors (Cannot Proceed)
**Example of what NOT to do:**
- [x] Implementation blocked: required project sources missing from workspace.
**Example of what TO do:** Report the error directly in your response:
Error: Cannot proceed with implementation. The Acme codebase is not present in the workspace.
Please ensure the codebase is available before running the implementation phase.
CRITICAL: Implement Result JSON
`;

Deno.test("looksLikePromptDump detects implement system prompt markers", () => {
  assertEquals(looksLikePromptDump(PROMPT_EXAMPLE_STDERR), true);
  assertEquals(looksLikePromptDump("agent wrote a normal log line"), false);
});

Deno.test("detectBlockingError ignores prompt-example text in stderr", () => {
  assertEquals(
    detectBlockingError(
      "Implemented dn init wizard successfully.\n",
      PROMPT_EXAMPLE_STDERR,
    ),
    null,
  );
});

Deno.test("detectBlockingError still catches blockers in stdout", () => {
  const message = detectBlockingError(
    "Error: Cannot proceed with implementation. Required sources are missing.\n",
    "",
  );
  assertEquals(message?.includes("Cannot proceed with implementation"), true);
});

Deno.test("detectBlockingError scans clean stderr when not a prompt dump", () => {
  const message = detectBlockingError(
    "",
    "Error: Cannot proceed with implementation. Workspace configuration broken.\n",
  );
  assertEquals(message?.includes("Cannot proceed with implementation"), true);
});

Deno.test("resolveImplementBlockingError trusts structured non-blocked result", () => {
  const result = resolveImplementBlockingError(
    {
      status: "incomplete",
      recommendation: "edit_plan",
      summary: "Mostly done; one criterion needs plan edit.",
    },
    "Error: Cannot proceed with implementation. (should be ignored)\n",
    PROMPT_EXAMPLE_STDERR,
  );
  assertEquals(result, null);
});

Deno.test("resolveImplementBlockingError uses structured blocked summary", () => {
  const result = resolveImplementBlockingError(
    {
      status: "blocked",
      recommendation: "blocked",
      summary: "Missing checkout of the target repository.",
    },
    "success looking stdout",
    "",
  );
  assertEquals(result, "Missing checkout of the target repository.");
});

Deno.test("resolveImplementBlockingError falls back to heuristic without structured result", () => {
  const result = resolveImplementBlockingError(
    null,
    "Error: Cannot proceed with implementation. Required sources are missing.\n",
    PROMPT_EXAMPLE_STDERR,
  );
  assertEquals(result?.includes("Cannot proceed with implementation"), true);
});

Deno.test({
  name: "implement system prompt no longer embeds Tonite blocker examples",
  permissions: { read: true },
  async fn() {
    const prompt = await Deno.readTextFile(
      new URL("./system.prompt.implement.md", import.meta.url),
    );
    assertEquals(prompt.includes("Tonite"), false);
    assertEquals(prompt.includes("Cannot proceed with implementation"), false);
    assertEquals(prompt.includes("codebase not present"), false);
  },
});
