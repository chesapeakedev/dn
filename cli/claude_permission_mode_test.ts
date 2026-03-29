// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { resolveClaudePermissionModeFromEnv } from "../sdk/github/claudeAgent.ts";

Deno.test("resolveClaudePermissionModeFromEnv defaults to acceptEdits", () => {
  const prev = Deno.env.get("CLAUDE_PERMISSION_MODE");
  try {
    Deno.env.delete("CLAUDE_PERMISSION_MODE");
    assertEquals(resolveClaudePermissionModeFromEnv(), "acceptEdits");
  } finally {
    if (prev !== undefined) {
      Deno.env.set("CLAUDE_PERMISSION_MODE", prev);
    }
  }
});

Deno.test("resolveClaudePermissionModeFromEnv trims and validates", () => {
  const prev = Deno.env.get("CLAUDE_PERMISSION_MODE");
  try {
    Deno.env.set("CLAUDE_PERMISSION_MODE", "  bypassPermissions  ");
    assertEquals(
      resolveClaudePermissionModeFromEnv(),
      "bypassPermissions",
    );
  } finally {
    if (prev !== undefined) {
      Deno.env.set("CLAUDE_PERMISSION_MODE", prev);
    } else {
      Deno.env.delete("CLAUDE_PERMISSION_MODE");
    }
  }
});

Deno.test("resolveClaudePermissionModeFromEnv rejects unknown mode", () => {
  const prev = Deno.env.get("CLAUDE_PERMISSION_MODE");
  try {
    Deno.env.set("CLAUDE_PERMISSION_MODE", "nope");
    assertThrows(
      () => resolveClaudePermissionModeFromEnv(),
      Error,
      "Invalid CLAUDE_PERMISSION_MODE",
    );
  } finally {
    if (prev !== undefined) {
      Deno.env.set("CLAUDE_PERMISSION_MODE", prev);
    } else {
      Deno.env.delete("CLAUDE_PERMISSION_MODE");
    }
  }
});
