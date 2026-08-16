// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import {
  formatDetail,
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
  setAgentTrace,
  setUnattended,
} from "./output.ts";

function hasAnsiEscape(s: string): boolean {
  return s.includes("\x1b[");
}

Deno.test({
  name: "output formatters emit no ANSI when NO_COLOR is set",
  permissions: { env: true },
  fn() {
    const prev = Deno.env.get("NO_COLOR");
    Deno.env.set("NO_COLOR", "1");
    setUnattended(false);
    setAgentTrace(false);
    try {
      assert(!hasAnsiEscape(formatSuccess("ok")), "formatSuccess");
      assert(!hasAnsiEscape(formatWarning("warn")), "formatWarning");
      assert(!hasAnsiEscape(formatError("err")), "formatError");
      assert(!hasAnsiEscape(formatInfo("info")), "formatInfo");
      assert(!hasAnsiEscape(formatStep(1, "step")), "formatStep");
      assert(!hasAnsiEscape(formatDetail("detail")), "formatDetail");
    } finally {
      if (prev !== undefined) {
        Deno.env.set("NO_COLOR", prev);
      } else {
        Deno.env.delete("NO_COLOR");
      }
      setAgentTrace(null);
      setUnattended(false);
    }
  },
});

Deno.test("output formatters use ASCII markers when unattended", () => {
  setUnattended(true);
  setAgentTrace(null);
  try {
    const success = formatSuccess("done");
    assert(success.includes("[dn]"));
    assert(success.includes("[OK]"));
    assert(!success.includes("✅"));

    const step = formatStep(2, "Running phase...");
    assert(step.includes("[dn]"));
    assert(step.includes("Step 2:"));

    const warn = formatWarning("something");
    assert(warn.includes("[dn]"));
    assert(warn.includes("[WARN]"));

    const err = formatError("failed");
    assert(err.includes("[dn]"));
    assert(err.includes("[ERROR]"));

    const info = formatInfo("note");
    assertEquals(info, "[dn] note");

    const detail = formatDetail("Issue: #1");
    assertEquals(detail, "[dn] Issue: #1");
  } finally {
    setUnattended(false);
  }
});

Deno.test({
  name: "attended quiet formatters omit [dn], Step N, and success/info emoji",
  permissions: { env: true },
  fn() {
    setUnattended(false);
    setAgentTrace(false);
    const prev = Deno.env.get("NO_COLOR");
    Deno.env.set("NO_COLOR", "1");
    try {
      assertEquals(
        formatStep(3, "Skipping plan phase..."),
        "Skipping plan phase...",
      );
      assert(!formatStep(3, "Skipping plan phase...").includes("Step"));

      assertEquals(formatSuccess("Linting passed"), "Linting passed");
      assert(!formatSuccess("ok").includes("✅"));
      assert(!formatSuccess("ok").includes("[dn]"));

      assertEquals(formatInfo("Issue: #404"), "Issue: #404");
      assert(!formatInfo("x").includes("ℹ️"));

      assertEquals(formatDetail("agent=codex"), "  agent=codex");

      assert(formatWarning("careful").includes("⚠️"));
      assert(formatError("boom").includes("❌"));
      assert(!formatWarning("careful").includes("[dn]"));
      assert(!formatError("boom").includes("[dn]"));
    } finally {
      if (prev !== undefined) {
        Deno.env.set("NO_COLOR", prev);
      } else {
        Deno.env.delete("NO_COLOR");
      }
      setAgentTrace(null);
      setUnattended(false);
    }
  },
});

Deno.test("attended with agent-trace brands lines like unattended", () => {
  setUnattended(false);
  setAgentTrace(true);
  try {
    assertEquals(formatInfo("mixed"), "[dn] mixed");
    assert(formatStep(1, "go").includes("[dn] Step 1:"));
    assert(formatSuccess("done").includes("[OK]"));
  } finally {
    setAgentTrace(null);
    setUnattended(false);
  }
});
