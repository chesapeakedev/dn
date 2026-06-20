// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  parsePublishMode,
  parseStackMode,
  resolveInitStackPublishMode,
  resolveKickstartPublishMode,
  resolveStackMode,
} from "./publish.ts";

Deno.test("parsePublishMode accepts supported values", () => {
  assertEquals(parsePublishMode("pr"), "pr");
  assertEquals(parsePublishMode("DIRECT"), "direct");
  assertEquals(parsePublishMode("none"), "none");
});

Deno.test("parsePublishMode rejects unknown values", () => {
  assertThrows(() => parsePublishMode("branch"), Error);
});

Deno.test("resolveKickstartPublishMode prefers publish over awp", () => {
  assertEquals(
    resolveKickstartPublishMode({ publish: "direct", awp: true }),
    "direct",
  );
  assertEquals(resolveKickstartPublishMode({ awp: false }), "none");
  assertEquals(
    resolveKickstartPublishMode({ awp: true, defaultMode: "none" }),
    "pr",
  );
});

Deno.test("resolveStackMode maps legacy refresh boolean", () => {
  assertEquals(resolveStackMode({ refresh: true }), "refresh");
  assertEquals(resolveStackMode({ refresh: false }), "create");
  assertEquals(
    resolveStackMode({ stackMode: "overwrite", refresh: true }),
    "overwrite",
  );
});

Deno.test("parseStackMode accepts supported values", () => {
  assertEquals(parseStackMode("refresh"), "refresh");
});

Deno.test("resolveInitStackPublishMode rejects pr", () => {
  assertThrows(
    () => resolveInitStackPublishMode({ publish: "pr" }),
    Error,
    "init stack publish mode must be direct or none",
  );
});
