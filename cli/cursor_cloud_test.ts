// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { parseKickstartArgs } from "./kickstart.ts";
import { parseLoopArgs } from "./loop.ts";

Deno.test("kickstart parses an explicit Cursor cloud starting ref", async () => {
  const config = await parseKickstartArgs([
    "--cursor-cloud",
    "--ref",
    "feature/cloud-dispatch",
    "--publish",
    "pr",
    "https://github.com/example/widgets/issues/12",
  ]);

  assertEquals(config.cursorCloud, true);
  assertEquals(config.cursorCloudRef, "feature/cloud-dispatch");
  assertEquals(config.publish, "pr");
  assertEquals(
    config.issueUrl,
    "https://github.com/example/widgets/issues/12",
  );
});

Deno.test("kickstart parses verbosity and skip-plan options", async () => {
  const config = await parseKickstartArgs([
    "--verbosity",
    "low",
    "--skip-plan",
    "123",
  ]);
  assertEquals(config.verbosity, "low");
  assertEquals(config.skipPlan, true);
  assertEquals((await parseKickstartArgs(["123"])).verbosity, "medium");
  await assertRejects(
    () => parseKickstartArgs(["--verbosity", "verbose", "123"]),
    Error,
    "low, medium, high",
  );
});

Deno.test("loop parses an explicit Cursor cloud starting ref", async () => {
  const config = await parseLoopArgs([
    "--cursor-cloud",
    "--ref",
    "release/1.x",
    "plans/release.plan.md",
  ]);

  assertEquals(config.cursorCloud, true);
  assertEquals(config.cursorCloudRef, "release/1.x");
  assertEquals(config.target, {
    kind: "plan-file",
    path: "plans/release.plan.md",
  });
});

Deno.test("kickstart and loop preserve steering prompts", async () => {
  const steeringPrompt =
    "Prioritize the parser, then add tests: do not refactor.";
  assertEquals(
    (await parseKickstartArgs(["--steer", steeringPrompt, "123"]))
      .steeringPrompt,
    steeringPrompt,
  );
  assertEquals(
    (await parseLoopArgs(["--steer", steeringPrompt, "plans/work.plan.md"]))
      .steeringPrompt,
    steeringPrompt,
  );
  assertEquals(
    (await parseKickstartArgs(["123"])).steeringPrompt,
    undefined,
  );
  assertEquals(
    (await parseLoopArgs(["plans/work.plan.md"])).steeringPrompt,
    undefined,
  );
});

Deno.test("kickstart and loop parse --context-file without treating the path as input", async () => {
  const notes = "notes.md";
  const kickstart = await parseKickstartArgs([
    "--context-file",
    notes,
    "123",
  ]);
  assertEquals(kickstart.issueUrl, "123");
  assertEquals(kickstart.contextFiles?.length, 1);
  assertEquals(kickstart.contextFiles?.[0].endsWith("notes.md"), true);

  const loop = await parseLoopArgs([
    "--context-file",
    notes,
    "plans/work.plan.md",
  ]);
  assertEquals(loop.target, {
    kind: "plan-file",
    path: "plans/work.plan.md",
  });
  assertEquals(loop.contextFiles?.length, 1);
  assertEquals(loop.contextFiles?.[0].endsWith("notes.md"), true);
});

Deno.test("Cursor cloud CLI defaults the starting ref to main", async () => {
  const kickstart = await parseKickstartArgs(["--cursor-cloud", "task.md"]);
  assertEquals(kickstart.cursorCloudRef, "main");
  assertEquals(kickstart.publish, "pr");
  assertEquals(
    (await parseLoopArgs(["--cursor-cloud", "plan.md"])).cursorCloudRef,
    "main",
  );
});

for (const publish of ["none", "direct"]) {
  Deno.test(`Cursor cloud rejects explicit ${publish} publishing`, async () => {
    await assertRejects(
      () =>
        parseKickstartArgs([
          "--cursor-cloud",
          "--publish",
          publish,
          "task.md",
        ]),
      Error,
      "requires --publish pr",
    );
  });
}

Deno.test("Cursor cloud mode rejects a simultaneous local Cursor agent", async () => {
  await assertRejects(
    () =>
      parseKickstartArgs([
        "--cursor-cloud",
        "--cursor",
        "task.md",
      ]),
    Error,
    "cannot be combined",
  );
});

for (const parseArgs of [parseKickstartArgs, parseLoopArgs]) {
  Deno.test(`${parseArgs.name} rejects a missing --steer value`, async () => {
    await assertRejects(
      () => parseArgs(["--steer"]),
      Error,
      "--steer requires",
    );
  });

  Deno.test(`${parseArgs.name} requires cloud mode for --ref`, async () => {
    await assertRejects(
      () => parseArgs(["--ref", "feature/cloud-dispatch", "task.md"]),
      Error,
      "--ref requires --cursor-cloud",
    );
  });

  Deno.test(`${parseArgs.name} rejects a missing --ref value`, async () => {
    await assertRejects(
      () => parseArgs(["--cursor-cloud", "--ref"]),
      Error,
      "--ref requires",
    );
  });
}
