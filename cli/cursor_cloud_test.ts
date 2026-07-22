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

Deno.test("Cursor cloud CLI defaults the starting ref to main", () => {
  assertEquals(
    parseKickstartArgs(["--cursor-cloud", "task.md"]).cursorCloudRef,
    "main",
  );
  assertEquals(
    parseLoopArgs(["--cursor-cloud", "plan.md"]).cursorCloudRef,
    "main",
  );
});

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
