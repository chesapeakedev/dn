// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  inferWorkspaceBackendFromRef,
  parseWorkspaceFlags,
  resolveWorkspaceBackend,
} from "./workspaceBackend.ts";

Deno.test("parseWorkspaceFlags strips backend flags", () => {
  const parsed = parseWorkspaceFlags([
    "--denoise",
    "--api-url",
    "https://qa.example",
    "create",
    "--title",
    "x",
  ]);
  assertEquals(parsed.backend, "denoise");
  assertEquals(parsed.apiUrl, "https://qa.example");
  assertEquals(parsed.args[0], "create");
});

Deno.test("inferWorkspaceBackendFromRef detects Denoise URLs", () => {
  assertEquals(
    inferWorkspaceBackendFromRef("https://denoise.cloud/task/abc"),
    "denoise",
  );
  assertEquals(inferWorkspaceBackendFromRef("#42"), "github");
});

Deno.test("resolveWorkspaceBackend prefers explicit flag", () => {
  assertEquals(
    resolveWorkspaceBackend({
      explicit: "github",
      config: { workspace: { default_backend: "denoise" } },
    }),
    "github",
  );
});
