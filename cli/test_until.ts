// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  applyMetadataToPrompt,
  DEFAULT_VERDICT_PATH,
  extractVerdictJson,
  parseUntilConfig,
  resolvePromptDone,
  runGambit,
} from "./until.ts";

Deno.test("parseUntilConfig accepts a single bounded script gambit", () => {
  const config = parseUntilConfig({
    name: "check",
    generator: { script: "true" },
    verifier: { script: "true" },
    secrets: ["TOKEN"],
  });
  assertEquals(config.gambits.length, 1);
  assertEquals(config.gambits[0].max_iterations, 10);
  assertEquals(config.gambits[0].secrets, ["TOKEN"]);
});

Deno.test("parseUntilConfig rejects actions with both execution modes", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        generator: { prompt: "do work", script: "true" },
        verifier: { script: "true" },
      }),
    Error,
    "exactly one string",
  );
});

Deno.test("parseUntilConfig rejects max_iterations below 1", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        generator: { script: "true" },
        verifier: { script: "true" },
        max_iterations: 0,
      }),
    Error,
    "positive integer",
  );
});

Deno.test("parseUntilConfig accepts prompt verifier done_when and verdict_path", () => {
  const config = parseUntilConfig({
    generator: { prompt: "work on {{goal}}" },
    verifier: {
      prompt: "check {{goal}}",
      verdict_path: ".dn/custom-verdict.json",
      done_when: { stdout_contains: "UNTIL_DONE" },
    },
    metadata: { goal: "ship auth" },
  });
  assertEquals(
    config.gambits[0].verifier.verdict_path,
    ".dn/custom-verdict.json",
  );
  assertEquals(
    config.gambits[0].verifier.done_when?.stdout_contains,
    "UNTIL_DONE",
  );
  assertEquals(config.gambits[0].metadata.goal, "ship auth");
});

Deno.test("parseUntilConfig rejects done_when on script verifiers", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        generator: { script: "true" },
        verifier: {
          script: "true",
          done_when: { stdout_contains: "DONE" },
        },
      }),
    Error,
    "prompt verifiers",
  );
});

Deno.test("applyMetadataToPrompt substitutes placeholders and prepends context", () => {
  const rendered = applyMetadataToPrompt(
    "Implement {{goal}} in {{path}}",
    { goal: "coverage", path: "cli/" },
  );
  assertEquals(
    rendered.includes("## Context"),
    true,
  );
  assertEquals(rendered.includes("- goal: coverage"), true);
  assertEquals(rendered.includes("Implement coverage in cli/"), true);
});

Deno.test("extractVerdictJson prefers the last fenced JSON block", () => {
  const parsed = extractVerdictJson(
    'notes\n```json\n{"done": false}\n```\nmore\n```json\n{"done": true, "reason": "ok"}\n```\n',
  );
  assertEquals(parsed?.done, true);
});

Deno.test("extractVerdictJson falls back to the last object in stdout", () => {
  const parsed = extractVerdictJson('thinking...\n{"done": true}\n');
  assertEquals(parsed?.done, true);
});

Deno.test("extractVerdictJson returns null when nothing parseable", () => {
  assertEquals(extractVerdictJson("no json here"), null);
});

Deno.test("resolvePromptDone reads verdict file first", async () => {
  const root = await Deno.makeTempDir();
  try {
    const verdictPath = join(root, DEFAULT_VERDICT_PATH);
    await Deno.mkdir(join(root, ".dn"), { recursive: true });
    await Deno.writeTextFile(
      verdictPath,
      JSON.stringify({ done: true, reason: "file" }),
    );
    const done = await resolvePromptDone(
      root,
      { prompt: "check" },
      { code: 0, stdout: '{"done": false}', stderr: "" },
      false,
    );
    assertEquals(done, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolvePromptDone continues on done false from stdout JSON", async () => {
  const root = await Deno.makeTempDir();
  try {
    const done = await resolvePromptDone(
      root,
      { prompt: "check" },
      { code: 0, stdout: 'Agent notes\n{"done": false}\n', stderr: "" },
      false,
    );
    assertEquals(done, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolvePromptDone honors done_when stdout_contains", async () => {
  const root = await Deno.makeTempDir();
  try {
    const done = await resolvePromptDone(
      root,
      { prompt: "check", done_when: { stdout_contains: "UNTIL_DONE" } },
      { code: 0, stdout: "all good UNTIL_DONE\n", stderr: "" },
      false,
    );
    assertEquals(done, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolvePromptDone throws under strictVerdict without a verdict", async () => {
  const root = await Deno.makeTempDir();
  try {
    await assertRejects(
      () =>
        resolvePromptDone(
          root,
          { prompt: "check" },
          { code: 0, stdout: "nope", stderr: "" },
          true,
        ),
      Error,
      "no verdict",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runGambit stops after a successful script verifier", async () => {
  const config = parseUntilConfig({
    generator: { script: "true" },
    verifier: { script: "true" },
  });
  await runGambit(config.gambits[0], Deno.cwd(), "opencode", { once: false });
});

Deno.test("runGambit reports an unfinished bounded gambit", async () => {
  const config = parseUntilConfig({
    generator: { script: "true" },
    verifier: { script: "false" },
    max_iterations: 1,
  });
  await assertRejects(
    () => runGambit(config.gambits[0], Deno.cwd(), "opencode", { once: false }),
    Error,
    "did not complete",
  );
});
