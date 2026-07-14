// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { parseHcConfig, runGambit } from "./hc.ts";

Deno.test("parseHcConfig accepts a single bounded script gambit", () => {
  const config = parseHcConfig({
    name: "check",
    generator: { script: "true" },
    verifier: { script: "true" },
    secrets: ["TOKEN"],
  });
  assertEquals(config.gambits.length, 1);
  assertEquals(config.gambits[0].max_iterations, 10);
  assertEquals(config.gambits[0].secrets, ["TOKEN"]);
});

Deno.test("parseHcConfig rejects actions with both execution modes", () => {
  assertThrows(
    () =>
      parseHcConfig({
        generator: { prompt: "do work", script: "true" },
        verifier: { script: "true" },
      }),
    Error,
    "exactly one string",
  );
});

Deno.test("runGambit stops after a successful script verifier", async () => {
  const config = parseHcConfig({
    generator: { script: "true" },
    verifier: { script: "true" },
  });
  await runGambit(config.gambits[0], Deno.cwd(), "opencode", false);
});

Deno.test("runGambit reports an unfinished bounded gambit", async () => {
  const config = parseHcConfig({
    generator: { script: "true" },
    verifier: { script: "false" },
    max_iterations: 1,
  });
  await assertRejects(
    () => runGambit(config.gambits[0], Deno.cwd(), "opencode", false),
    Error,
    "did not complete",
  );
});
