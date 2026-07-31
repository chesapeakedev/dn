// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertStringIncludes } from "@std/assert";
import { readIncludedSystemPrompt } from "./includedPrompt.ts";

Deno.test("readIncludedSystemPrompt finds land prompt from kickstart/", async () => {
  const content = await readIncludedSystemPrompt("system.prompt.land.md");
  assertStringIncludes(content, "Land");
});

Deno.test("readIncludedSystemPrompt finds testplan prompt from kickstart/", async () => {
  const content = await readIncludedSystemPrompt("system.prompt.testplan.md");
  assertStringIncludes(content, "Test Plan");
});
