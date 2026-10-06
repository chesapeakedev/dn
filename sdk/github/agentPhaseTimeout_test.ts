// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  agentPhaseTimeoutWarningMs,
  DEFAULT_IMPLEMENT_TIMEOUT_MS,
  DEFAULT_PLAN_TIMEOUT_MS,
  resolveAgentPhaseTimeoutMs,
} from "./agentPhaseTimeout.ts";

const ENV_KEYS = [
  "PLAN_TIMEOUT_MS",
  "IMPLEMENT_TIMEOUT_MS",
  "OPENCODE_TIMEOUT_MS",
] as const;

function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, Deno.env.get(key));
    const next = values[key];
    if (next === undefined) Deno.env.delete(key);
    else Deno.env.set(key, next);
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("resolveAgentPhaseTimeoutMs uses phase defaults with no env", () => {
  withEnv({}, () => {
    assertEquals(resolveAgentPhaseTimeoutMs("plan"), DEFAULT_PLAN_TIMEOUT_MS);
    assertEquals(
      resolveAgentPhaseTimeoutMs("implement"),
      DEFAULT_IMPLEMENT_TIMEOUT_MS,
    );
  });
});

Deno.test("resolveAgentPhaseTimeoutMs prefers phase-specific env", () => {
  withEnv({ IMPLEMENT_TIMEOUT_MS: "900000" }, () => {
    assertEquals(resolveAgentPhaseTimeoutMs("implement"), 900_000);
    assertEquals(resolveAgentPhaseTimeoutMs("plan"), DEFAULT_PLAN_TIMEOUT_MS);
  });
});

Deno.test("resolveAgentPhaseTimeoutMs prefers harness override over OPENCODE", () => {
  withEnv({ OPENCODE_TIMEOUT_MS: "300000" }, () => {
    assertEquals(
      resolveAgentPhaseTimeoutMs("implement", { harnessTimeoutMs: 450_000 }),
      450_000,
    );
  });
});

Deno.test("agentPhaseTimeoutWarningMs caps at ten minutes", () => {
  assertEquals(agentPhaseTimeoutWarningMs(1_200_000), 600_000);
  assertEquals(agentPhaseTimeoutWarningMs(300_000), 240_000);
});
