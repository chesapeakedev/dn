// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertStringIncludes } from "@std/assert";
import { runDnCommand } from "./test_utils.ts";

Deno.test("runner CLI exposes the device command surface", async () => {
  const result = await runDnCommand(["runner", "--help"]);
  assertStringIncludes(result.stdout, "dn runner connect");
  assertStringIncludes(result.stdout, "dn runner status");
  assertStringIncludes(result.stdout, "dn runner install");
  assertStringIncludes(result.stdout, "dn runner start");
  assertStringIncludes(result.stdout, "dn runner stop");
  assertStringIncludes(result.stdout, "dn runner serve");
});

Deno.test("runner CLI does not expose issue dispatch", async () => {
  const result = await runDnCommand(["runner", "kickstart"], {
    expectFailure: true,
  });
  assertStringIncludes(result.stderr, "Unknown runner subcommand: kickstart");
});
