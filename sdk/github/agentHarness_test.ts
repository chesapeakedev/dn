// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  parseAgentHarness,
  resolveAgentHarnessFromFlagsAndEnv,
} from "./agentHarness.ts";

Deno.test("parseAgentHarness accepts codex", () => {
  assertEquals(parseAgentHarness("codex"), "codex");
});

Deno.test("parseAgentHarness rejects unknown agents", () => {
  assertThrows(
    () => parseAgentHarness("unknown"),
    Error,
    "Invalid agent",
  );
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv uses explicit global agent", () => {
  assertEquals(
    resolveAgentHarnessFromFlagsAndEnv({
      agent: "codex",
      cursorFlag: false,
      claudeFlag: false,
    }),
    "codex",
  );
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv rejects conflicting explicit selections", () => {
  assertThrows(
    () =>
      resolveAgentHarnessFromFlagsAndEnv({
        agent: "codex",
        cursorFlag: true,
        claudeFlag: false,
      }),
    Error,
    "Conflicting agent selections",
  );
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv supports CODEX_ENABLED", () => {
  const previous = Deno.env.get("CODEX_ENABLED");
  try {
    Deno.env.set("CODEX_ENABLED", "1");
    assertEquals(
      resolveAgentHarnessFromFlagsAndEnv({
        cursorFlag: false,
        claudeFlag: false,
      }),
      "codex",
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete("CODEX_ENABLED");
    } else {
      Deno.env.set("CODEX_ENABLED", previous);
    }
  }
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv rejects multiple env agents", () => {
  const previousCodex = Deno.env.get("CODEX_ENABLED");
  const previousClaude = Deno.env.get("CLAUDE_ENABLED");
  try {
    Deno.env.set("CODEX_ENABLED", "1");
    Deno.env.set("CLAUDE_ENABLED", "1");
    assertThrows(
      () =>
        resolveAgentHarnessFromFlagsAndEnv({
          cursorFlag: false,
          claudeFlag: false,
        }),
      Error,
      "Conflicting agent environment variables",
    );
  } finally {
    if (previousCodex === undefined) {
      Deno.env.delete("CODEX_ENABLED");
    } else {
      Deno.env.set("CODEX_ENABLED", previousCodex);
    }
    if (previousClaude === undefined) {
      Deno.env.delete("CLAUDE_ENABLED");
    } else {
      Deno.env.set("CLAUDE_ENABLED", previousClaude);
    }
  }
});
