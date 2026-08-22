// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  extractAgentSelectionFromArgs,
  formatAgentHarnessName,
  formatAgentSelection,
  parseAgentHarness,
  parseAgentSelection,
  resolveAgentHarnessFromFlagsAndEnv,
} from "./agentHarness.ts";

Deno.test("parseAgentHarness accepts supported harness names", () => {
  assertEquals(parseAgentHarness("codex"), "codex");
  assertEquals(parseAgentHarness("copilot"), "copilot");
});

Deno.test("formatAgentHarnessName returns user-facing harness names", () => {
  assertEquals(formatAgentHarnessName("opencode"), "OpenCode");
  assertEquals(formatAgentHarnessName("cursor"), "Cursor headless agent");
  assertEquals(formatAgentHarnessName("claude"), "Claude Code");
  assertEquals(formatAgentHarnessName("codex"), "Codex CLI");
  assertEquals(formatAgentHarnessName("copilot"), "GitHub Copilot CLI");
});

Deno.test("parseAgentHarness rejects unknown agents", () => {
  assertThrows(
    () => parseAgentHarness("unknown"),
    Error,
    "Invalid agent",
  );
});

Deno.test("parseAgentSelection accepts a bare harness", () => {
  assertEquals(parseAgentSelection("opencode"), { harness: "opencode" });
});

Deno.test("parseAgentSelection accepts harness:model without thinking", () => {
  assertEquals(parseAgentSelection("codex:gpt-5.4"), {
    harness: "codex",
    model: "gpt-5.4",
  });
});

Deno.test("parseAgentSelection accepts an optional thinking segment", () => {
  assertEquals(parseAgentSelection("claude:opus:high"), {
    harness: "claude",
    model: "opus",
    thinking: "high",
  });
});

Deno.test("parseAgentSelection keeps slashes in OpenCode model ids", () => {
  assertEquals(
    parseAgentSelection("opencode:openrouter/openai/gpt-5.6-luna:high"),
    {
      harness: "opencode",
      model: "openrouter/openai/gpt-5.6-luna",
      thinking: "high",
    },
  );
});

Deno.test("parseAgentSelection rejects empty segments", () => {
  assertThrows(() => parseAgentSelection(":gpt-5.4"), Error, "Invalid agent");
  assertThrows(() => parseAgentSelection("codex:"), Error, "Invalid agent");
  assertThrows(
    () => parseAgentSelection("codex::high"),
    Error,
    "Invalid agent",
  );
});

Deno.test("parseAgentSelection rejects an unknown harness", () => {
  assertThrows(
    () => parseAgentSelection("unknown:gpt"),
    Error,
    "Invalid agent",
  );
});

Deno.test("parseAgentSelection rejects thinking for cursor and copilot", () => {
  assertThrows(
    () => parseAgentSelection("cursor:gpt-5:high"),
    Error,
    "does not accept a thinking segment",
  );
  assertThrows(
    () => parseAgentSelection("copilot:gpt-5:high"),
    Error,
    "does not accept a thinking segment",
  );
});

Deno.test("formatAgentSelection round-trips parsed values", () => {
  assertEquals(formatAgentSelection({ harness: "opencode" }), "opencode");
  assertEquals(
    formatAgentSelection({ harness: "codex", model: "gpt-5.4" }),
    "codex:gpt-5.4",
  );
  assertEquals(
    formatAgentSelection({
      harness: "opencode",
      model: "openrouter/openai/gpt-5.6-luna",
      thinking: "high",
    }),
    "opencode:openrouter/openai/gpt-5.6-luna:high",
  );
});

Deno.test("extractAgentSelectionFromArgs reads --agent and leaves other args", () => {
  assertEquals(
    extractAgentSelectionFromArgs([
      "meld",
      "--update-issue",
      "--agent",
      "copilot",
      "123",
    ]),
    {
      selection: { harness: "copilot" },
      rest: ["meld", "--update-issue", "123"],
    },
  );
});

Deno.test("extractAgentSelectionFromArgs rejects removed harness aliases", () => {
  assertThrows(
    () => extractAgentSelectionFromArgs(["--codex", "123"]),
    Error,
    "Unknown option: --codex",
  );
  assertThrows(
    () => extractAgentSelectionFromArgs(["--cursor", "123"]),
    Error,
    "Unknown option: --cursor",
  );
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv uses explicit --agent", () => {
  assertEquals(
    resolveAgentHarnessFromFlagsAndEnv({
      agent: { harness: "codex", model: "gpt-5.4" },
    }),
    { harness: "codex", model: "gpt-5.4" },
  );
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv uses fallbackAgent after env", () => {
  const previous = Deno.env.get("DN_AGENT");
  try {
    Deno.env.delete("DN_AGENT");
    assertEquals(
      resolveAgentHarnessFromFlagsAndEnv({
        fallbackAgent: "cursor",
      }),
      { harness: "cursor" },
    );
  } finally {
    if (previous === undefined) Deno.env.delete("DN_AGENT");
    else Deno.env.set("DN_AGENT", previous);
  }
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv parses DN_AGENT", () => {
  const previous = Deno.env.get("DN_AGENT");
  try {
    Deno.env.set("DN_AGENT", "codex:gpt-5.4");
    assertEquals(
      resolveAgentHarnessFromFlagsAndEnv(),
      { harness: "codex", model: "gpt-5.4" },
    );
  } finally {
    if (previous === undefined) Deno.env.delete("DN_AGENT");
    else Deno.env.set("DN_AGENT", previous);
  }
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv supports COPILOT_ENABLED", () => {
  const previous = Deno.env.get("COPILOT_ENABLED");
  const previousDnAgent = Deno.env.get("DN_AGENT");
  try {
    Deno.env.delete("DN_AGENT");
    Deno.env.set("COPILOT_ENABLED", "1");
    assertEquals(
      resolveAgentHarnessFromFlagsAndEnv(),
      { harness: "copilot" },
    );
  } finally {
    if (previous === undefined) Deno.env.delete("COPILOT_ENABLED");
    else Deno.env.set("COPILOT_ENABLED", previous);
    if (previousDnAgent === undefined) Deno.env.delete("DN_AGENT");
    else Deno.env.set("DN_AGENT", previousDnAgent);
  }
});

Deno.test("resolveAgentHarnessFromFlagsAndEnv rejects multiple env agents", () => {
  const previousCodex = Deno.env.get("CODEX_ENABLED");
  const previousClaude = Deno.env.get("CLAUDE_ENABLED");
  const previousDnAgent = Deno.env.get("DN_AGENT");
  try {
    Deno.env.delete("DN_AGENT");
    Deno.env.set("CODEX_ENABLED", "1");
    Deno.env.set("CLAUDE_ENABLED", "1");
    assertThrows(
      () => resolveAgentHarnessFromFlagsAndEnv(),
      Error,
      "Conflicting agent environment variables",
    );
  } finally {
    if (previousCodex === undefined) Deno.env.delete("CODEX_ENABLED");
    else Deno.env.set("CODEX_ENABLED", previousCodex);
    if (previousClaude === undefined) Deno.env.delete("CLAUDE_ENABLED");
    else Deno.env.set("CLAUDE_ENABLED", previousClaude);
    if (previousDnAgent === undefined) Deno.env.delete("DN_AGENT");
    else Deno.env.set("DN_AGENT", previousDnAgent);
  }
});
