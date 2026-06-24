// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { buildCopilotExecArgs } from "./copilotAgent.ts";

Deno.test("buildCopilotExecArgs uses non-interactive Copilot CLI flags", () => {
  assertEquals(
    buildCopilotExecArgs(
      "Read and execute the instructions in this file: /tmp/prompt.md",
    ),
    [
      "-p",
      "Read and execute the instructions in this file: /tmp/prompt.md",
      "-s",
      "--no-ask-user",
      "--allow-tool=write, shell(deno:*), shell(make:*), shell(sl:*)",
    ],
  );
});

Deno.test("buildCopilotExecArgs supports tool and model overrides", () => {
  assertEquals(
    buildCopilotExecArgs("Run the plan", {
      allowedTools: "write, shell(npm:*)",
      model: "gpt-5",
    }),
    [
      "-p",
      "Run the plan",
      "-s",
      "--no-ask-user",
      "--allow-tool=write, shell(npm:*)",
      "--model",
      "gpt-5",
    ],
  );
});
