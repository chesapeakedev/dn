// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { parseKickstartArgs } from "./kickstart.ts";
import { parseLoopArgs } from "./loop.ts";

Deno.test("kickstart parses an explicit Cursor cloud starting ref", () => {
  const config = parseKickstartArgs([
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

Deno.test("kickstart parses verbosity and skip-plan options", () => {
  const config = parseKickstartArgs([
    "--verbosity",
    "low",
    "--skip-plan",
    "123",
  ]);
  assertEquals(config.verbosity, "low");
  assertEquals(config.skipPlan, true);
  assertEquals(parseKickstartArgs(["123"]).verbosity, "medium");
  assertThrows(
    () => parseKickstartArgs(["--verbosity", "verbose", "123"]),
    Error,
    "low, medium, high",
  );
});

Deno.test("loop parses an explicit Cursor cloud starting ref", () => {
  const config = parseLoopArgs([
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

Deno.test("kickstart and loop preserve steering prompts", () => {
  const steeringPrompt =
    "Prioritize the parser, then add tests: do not refactor.";
  assertEquals(
    parseKickstartArgs(["--steer", steeringPrompt, "123"]).steeringPrompt,
    steeringPrompt,
  );
  assertEquals(
    parseLoopArgs(["--steer", steeringPrompt, "plans/work.plan.md"])
      .steeringPrompt,
    steeringPrompt,
  );
  assertEquals(parseKickstartArgs(["123"]).steeringPrompt, undefined);
  assertEquals(
    parseLoopArgs(["plans/work.plan.md"]).steeringPrompt,
    undefined,
  );
});

Deno.test("Cursor cloud CLI defaults the starting ref to main", () => {
  const kickstart = parseKickstartArgs(["--cursor-cloud", "task.md"]);
  assertEquals(kickstart.cursorCloudRef, "main");
  assertEquals(kickstart.publish, "pr");
  assertEquals(
    parseLoopArgs(["--cursor-cloud", "plan.md"]).cursorCloudRef,
    "main",
  );
});

for (const publish of ["none", "direct"]) {
  Deno.test(`Cursor cloud rejects explicit ${publish} publishing`, () => {
    assertThrows(
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

Deno.test("Cursor cloud mode rejects a simultaneous local Cursor agent", () => {
  assertThrows(
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
  Deno.test(`${parseArgs.name} rejects a missing --steer value`, () => {
    assertThrows(
      () => parseArgs(["--steer"]),
      Error,
      "--steer requires",
    );
  });

  Deno.test(`${parseArgs.name} requires cloud mode for --ref`, () => {
    assertThrows(
      () => parseArgs(["--ref", "feature/cloud-dispatch", "task.md"]),
      Error,
      "--ref requires --cursor-cloud",
    );
  });

  Deno.test(`${parseArgs.name} rejects a missing --ref value`, () => {
    assertThrows(
      () => parseArgs(["--cursor-cloud", "--ref"]),
      Error,
      "--ref requires",
    );
  });
}
