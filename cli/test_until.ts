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
  runUntil,
  scheduleIntervalIterations,
} from "./until.ts";

Deno.test("parseUntilConfig accepts a single bounded script gambit", () => {
  const config = parseUntilConfig({
    name: "check",
    generator: { script: "true" },
    verifier: { script: "true" },
    secrets: ["TOKEN"],
  });
  assertEquals(config.gambits.length, 1);
  assertEquals(config.iterations, 10);
  assertEquals(config.gambits[0].secrets, ["TOKEN"]);
  assertEquals(config.gambits[0].align, "spread");
  assertEquals(config.gambits[0].phase, "before");
});

Deno.test("parseUntilConfig accepts top-level iterations and interval gambits", () => {
  const config = parseUntilConfig({
    iterations: 4,
    gambits: [
      {
        name: "raise-coverage",
        generator: { script: "true" },
        verifier: { script: "true" },
      },
      {
        name: "review-tests",
        interval: 0.25,
        align: "end",
        phase: "after",
        generator: { script: "true" },
        verifier: { script: "true" },
      },
      {
        name: "ci-fix",
        one_shot: true,
        generator: { script: "true" },
        verifier: { script: "true" },
      },
    ],
  });
  assertEquals(config.iterations, 4);
  assertEquals(config.gambits[1].interval, 0.25);
  assertEquals(config.gambits[1].align, "end");
  assertEquals(config.gambits[1].phase, "after");
  assertEquals(config.gambits[2].one_shot, true);
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

Deno.test("parseUntilConfig rejects iterations below 1", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        generator: { script: "true" },
        verifier: { script: "true" },
        iterations: 0,
      }),
    Error,
    "positive integer",
  );
});

Deno.test("parseUntilConfig rejects removed max_iterations", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        generator: { script: "true" },
        verifier: { script: "true" },
        max_iterations: 1,
      }),
    Error,
    "max_iterations is removed",
  );
});

Deno.test("parseUntilConfig rejects removed generator_interval_ms", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        generator: { script: "true" },
        verifier: { script: "true" },
        generator_interval_ms: 100,
      }),
    Error,
    "generator_interval_ms is removed",
  );
});

Deno.test("parseUntilConfig rejects interval on primary", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        gambits: [
          {
            interval: 0.5,
            generator: { script: "true" },
            verifier: { script: "true" },
          },
        ],
      }),
    Error,
    "not allowed on the primary",
  );
});

Deno.test("parseUntilConfig rejects non-primary without interval or one_shot", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        gambits: [
          {
            generator: { script: "true" },
            verifier: { script: "true" },
          },
          {
            generator: { script: "true" },
            verifier: { script: "true" },
          },
        ],
      }),
    Error,
    "requires interval",
  );
});

Deno.test("parseUntilConfig rejects interval outside (0, 1]", () => {
  assertThrows(
    () =>
      parseUntilConfig({
        gambits: [
          {
            generator: { script: "true" },
            verifier: { script: "true" },
          },
          {
            interval: 1.5,
            generator: { script: "true" },
            verifier: { script: "true" },
          },
        ],
      }),
    Error,
    "(0, 1]",
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

Deno.test("scheduleIntervalIterations: 4 * 0.25 yields one spread slot at 2", () => {
  assertEquals(scheduleIntervalIterations(4, 0.25, "spread"), [2]);
});

Deno.test("scheduleIntervalIterations honors start and end align", () => {
  assertEquals(scheduleIntervalIterations(4, 0.5, "start"), [1, 2]);
  assertEquals(scheduleIntervalIterations(4, 0.5, "end"), [3, 4]);
});

Deno.test("scheduleIntervalIterations honors at override", () => {
  assertEquals(scheduleIntervalIterations(4, 0.5, "spread", [1, 4]), [1, 4]);
});

Deno.test("scheduleIntervalIterations rejects at longer than fire count", () => {
  assertThrows(
    () => scheduleIntervalIterations(4, 0.25, "spread", [1, 2]),
    Error,
    "exceeds",
  );
});

Deno.test("scheduleIntervalIterations caps fire count at n", () => {
  assertEquals(scheduleIntervalIterations(3, 1, "start"), [1, 2, 3]);
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

Deno.test("runUntil stops after a successful script verifier", async () => {
  const config = parseUntilConfig({
    generator: { script: "true" },
    verifier: { script: "true" },
  });
  await runUntil(config, Deno.cwd(), "opencode", { once: false });
});

Deno.test("runUntil reports an unfinished bounded primary", async () => {
  const config = parseUntilConfig({
    iterations: 1,
    generator: { script: "true" },
    verifier: { script: "false" },
  });
  await assertRejects(
    () => runUntil(config, Deno.cwd(), "opencode", { once: false }),
    Error,
    "did not complete",
  );
});

Deno.test("runUntil --once forces a single primary tick", async () => {
  const root = await Deno.makeTempDir();
  try {
    const counter = join(root, "primary.count");
    const config = parseUntilConfig({
      iterations: 8,
      gambits: [
        {
          generator: {
            script: `printf x >> "${counter}"`,
          },
          verifier: { script: "false" },
        },
      ],
    });
    await assertRejects(
      () => runUntil(config, root, "opencode", { once: true }),
      Error,
      "did not complete",
    );
    const count = (await Deno.readTextFile(counter)).length;
    assertEquals(count, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runUntil fires interval gambits only on scheduled iterations", async () => {
  const root = await Deno.makeTempDir();
  try {
    const primary = join(root, "primary.count");
    const review = join(root, "review.count");
    const gate = join(root, "gate");
    await Deno.writeTextFile(gate, "0");
    const config = parseUntilConfig({
      iterations: 4,
      gambits: [
        {
          name: "primary",
          generator: {
            script:
              `printf x >> "${primary}"; n=$(wc -c < "${primary}" | tr -d ' '); echo "$n" > "${gate}"`,
          },
          verifier: {
            script: `test "$(cat "${gate}")" -ge 3`,
          },
        },
        {
          name: "review",
          interval: 0.25,
          align: "spread",
          generator: { script: `printf x >> "${review}"` },
          verifier: { script: "false" },
        },
      ],
    });
    await runUntil(config, root, "opencode", { once: false });
    assertEquals((await Deno.readTextFile(primary)).length, 3);
    assertEquals((await Deno.readTextFile(review)).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runUntil runs one_shot tails after primary success", async () => {
  const root = await Deno.makeTempDir();
  try {
    const tail = join(root, "tail.count");
    const config = parseUntilConfig({
      iterations: 2,
      gambits: [
        {
          generator: { script: "true" },
          verifier: { script: "true" },
        },
        {
          name: "ci-fix",
          one_shot: true,
          generator: { script: `printf x >> "${tail}"` },
          verifier: { script: "true" },
        },
      ],
    });
    await runUntil(config, root, "opencode", { once: false });
    assertEquals((await Deno.readTextFile(tail)).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
