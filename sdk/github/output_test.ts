// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  bootstrapFromEnv,
  isAgentTraceEnabled,
  setAgentTrace,
  setUnattended,
} from "./output.ts";

Deno.test({
  name: "isAgentTraceEnabled defaults to unattended mode",
  permissions: { env: true },
  fn() {
    setAgentTrace(null);
    setUnattended(true);
    assertEquals(isAgentTraceEnabled(), true);
    setUnattended(false);
    assertEquals(isAgentTraceEnabled(), false);
  },
});

Deno.test({
  name: "isAgentTraceEnabled respects DN_AGENT_TRACE env",
  permissions: { env: true },
  fn() {
    setAgentTrace(null);
    const prev = Deno.env.get("DN_AGENT_TRACE");
    try {
      setUnattended(false);
      Deno.env.set("DN_AGENT_TRACE", "1");
      assertEquals(isAgentTraceEnabled(), true);
      Deno.env.set("DN_AGENT_TRACE", "0");
      assertEquals(isAgentTraceEnabled(), false);
      setUnattended(true);
      assertEquals(isAgentTraceEnabled(), false);
    } finally {
      if (prev === undefined) {
        Deno.env.delete("DN_AGENT_TRACE");
      } else {
        Deno.env.set("DN_AGENT_TRACE", prev);
      }
      setAgentTrace(null);
      setUnattended(false);
    }
  },
});

Deno.test({
  name: "isAgentTraceEnabled CLI override beats env and unattended",
  permissions: { env: true },
  fn() {
    const prev = Deno.env.get("DN_AGENT_TRACE");
    try {
      setUnattended(false);
      Deno.env.set("DN_AGENT_TRACE", "0");
      bootstrapFromEnv({ agentTrace: true });
      assertEquals(isAgentTraceEnabled(), true);

      Deno.env.set("DN_AGENT_TRACE", "1");
      bootstrapFromEnv({ agentTrace: false });
      assertEquals(isAgentTraceEnabled(), false);
    } finally {
      if (prev === undefined) {
        Deno.env.delete("DN_AGENT_TRACE");
      } else {
        Deno.env.set("DN_AGENT_TRACE", prev);
      }
      setAgentTrace(null);
      setUnattended(false);
    }
  },
});
