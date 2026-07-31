// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  formatAgentPhaseIntentLog,
  resolveConfiguredAgentModel,
} from "./agentModel.ts";

Deno.test("formatAgentPhaseIntentLog includes model when present", () => {
  assertEquals(
    formatAgentPhaseIntentLog("opencode", "deepinfra/zai-org/GLM-5.2"),
    "[dn] agent=opencode model=deepinfra/zai-org/GLM-5.2",
  );
});

Deno.test("formatAgentPhaseIntentLog omits model when unset", () => {
  assertEquals(formatAgentPhaseIntentLog("claude"), "[dn] agent=claude");
  assertEquals(formatAgentPhaseIntentLog("cursor", "  "), "[dn] agent=cursor");
});

Deno.test("resolveConfiguredAgentModel reads OpenCode phase config", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "opencode.plan.json"),
      JSON.stringify({
        model: "deepinfra/zai-org/GLM-5.2",
      }),
    );
    await Deno.writeTextFile(
      join(dir, "opencode.implement.json"),
      JSON.stringify({
        model: "deepinfra/zai-org/GLM-5.1",
      }),
    );
    await Deno.writeTextFile(
      join(dir, "opencode.json"),
      JSON.stringify({
        model: "minimax/m2.5-free",
      }),
    );

    assertEquals(
      await resolveConfiguredAgentModel("opencode", dir, true),
      "deepinfra/zai-org/GLM-5.2",
    );
    assertEquals(
      await resolveConfiguredAgentModel("opencode", dir, false),
      "deepinfra/zai-org/GLM-5.1",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resolveConfiguredAgentModel falls back to opencode.json", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "opencode.implement.json"),
      JSON.stringify({ permission: { edit: { "*": "allow" } } }),
    );
    await Deno.writeTextFile(
      join(dir, "opencode.json"),
      JSON.stringify({ model: "deepinfra/zai-org/GLM-5.2" }),
    );

    assertEquals(
      await resolveConfiguredAgentModel("opencode", dir, false),
      "deepinfra/zai-org/GLM-5.2",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resolveConfiguredAgentModel reads COPILOT_MODEL", async () => {
  const prev = Deno.env.get("COPILOT_MODEL");
  try {
    Deno.env.set("COPILOT_MODEL", "gpt-5");
    assertEquals(await resolveConfiguredAgentModel("copilot", "/tmp"), "gpt-5");
  } finally {
    if (prev === undefined) Deno.env.delete("COPILOT_MODEL");
    else Deno.env.set("COPILOT_MODEL", prev);
  }
});

Deno.test("resolveConfiguredAgentModel returns undefined for cursor/claude/codex", async () => {
  assertEquals(await resolveConfiguredAgentModel("cursor", "/tmp"), undefined);
  assertEquals(await resolveConfiguredAgentModel("claude", "/tmp"), undefined);
  assertEquals(await resolveConfiguredAgentModel("codex", "/tmp"), undefined);
});
