// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert } from "@std/assert";
import {
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
  setUnattended,
} from "./output.ts";

function hasAnsiEscape(s: string): boolean {
  return s.includes("\x1b[");
}

Deno.test("output formatters emit no ANSI when NO_COLOR is set", () => {
  const prev = Deno.env.get("NO_COLOR");
  Deno.env.set("NO_COLOR", "1");
  try {
    assert(!hasAnsiEscape(formatSuccess("ok")), "formatSuccess");
    assert(!hasAnsiEscape(formatWarning("warn")), "formatWarning");
    assert(!hasAnsiEscape(formatError("err")), "formatError");
    assert(!hasAnsiEscape(formatInfo("info")), "formatInfo");
    assert(!hasAnsiEscape(formatStep(1, "step")), "formatStep");
  } finally {
    if (prev !== undefined) {
      Deno.env.set("NO_COLOR", prev);
    } else {
      Deno.env.delete("NO_COLOR");
    }
  }
});

Deno.test("output formatters use ASCII markers when unattended", () => {
  setUnattended(true);
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
  } finally {
    setUnattended(false);
  }
});
