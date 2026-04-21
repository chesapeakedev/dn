// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert } from "@std/assert";
import { runDnCommand } from "./test_utils.ts";

Deno.test("issue help includes relationship subcommand", async () => {
  const result = await runDnCommand(["issue", "--help"], {
    expectFailure: false,
  });

  assert(result.stdout.includes("relationship"));
});

Deno.test("relationship help lists supported operations", async () => {
  const result = await runDnCommand(["issue", "relationship", "--help"], {
    expectFailure: false,
  });

  assert(result.stdout.includes("add blocked-by"));
  assert(result.stdout.includes("mark-duplicate"));
  assert(result.stdout.includes("reprioritize sub-issue"));
});
