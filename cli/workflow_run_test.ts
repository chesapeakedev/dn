// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for `dn workflows dispatch` flag parsing.
 * Requires --allow-read because importing the run handler pulls in modules
 * that may load .env via @std/dotenv at init time.
 */

import { assert } from "@std/assert";
import { parseWorkflowDispatchArgs } from "./workflow/run.ts";

Deno.test("parseWorkflowDispatchArgs extracts repo and fields", async () => {
  const options = await parseWorkflowDispatchArgs([
    "release.yml",
    "--repo",
    "acme/platform",
    "--ref",
    "main",
    "-f",
    "tag=v1.0.0",
    "-F",
    "notes=@/tmp/notes.md",
  ]);

  assert(options.selector === "release.yml");
  assert(options.repo?.owner === "acme");
  assert(options.repo?.repo === "platform");
  assert(options.ref === "main");
  assert(options.rawFields.length === 1);
  assert(options.magicFields.length === 1);
  assert(options.wait === false);
});

Deno.test("parseWorkflowDispatchArgs parses dispatch mode and wait", async () => {
  const options = await parseWorkflowDispatchArgs([
    "dn.init_stack",
    "--dispatch",
    "repository",
    "--wait",
    "--repo",
    "acme/platform",
  ]);

  assert(options.selector === "dn.init_stack");
  assert(options.dispatchMode === "repository");
  assert(options.wait === true);
  assert(options.repo?.owner === "acme");
});

Deno.test("parseWorkflowDispatchArgs requires workflow when fields passed", async () => {
  let threw = false;
  try {
    await parseWorkflowDispatchArgs(["-f", "name=value"]);
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error &&
        error.message.includes("workflow argument required"),
    );
  }
  assert(threw);
});

Deno.test("parseWorkflowDispatchArgs requires selector when not interactive", async () => {
  let threw = false;
  try {
    await parseWorkflowDispatchArgs([]);
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error &&
        error.message.includes("workflow ID, name, or filename required"),
    );
  }
  assert(threw);
});

Deno.test("parseWorkflowDispatchArgs rejects --json on a tty", async () => {
  if (!Deno.stdin.isTerminal()) {
    return;
  }
  let threw = false;
  try {
    await parseWorkflowDispatchArgs(["ci.yml", "--json"]);
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error &&
        error.message.includes("nothing on STDIN"),
    );
  }
  assert(threw);
});
