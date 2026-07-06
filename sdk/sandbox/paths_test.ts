// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { buildGitAddArgv, translateHostPathToSandbox } from "./paths.ts";

Deno.test("translateHostPathToSandbox maps repo root to sandbox workspace", () => {
  assertEquals(
    translateHostPathToSandbox(
      "/Users/me/project",
      "/Users/me/project",
      "/workspace",
    ),
    "/workspace",
  );
});

Deno.test("translateHostPathToSandbox maps nested paths", () => {
  assertEquals(
    translateHostPathToSandbox(
      "/Users/me/project/.dn/tmp/combined_prompt_plan.txt",
      "/Users/me/project",
      "/workspace",
    ),
    "/workspace/.dn/tmp/combined_prompt_plan.txt",
  );
});

Deno.test("translateHostPathToSandbox leaves external paths unchanged", () => {
  assertEquals(
    translateHostPathToSandbox("/tmp/other", "/Users/me/project", "/workspace"),
    "/tmp/other",
  );
});

Deno.test("buildGitAddArgv adds pathspec excludes", () => {
  assertEquals(
    buildGitAddArgv(["node_modules", ".git"]),
    [
      "git",
      "add",
      "-A",
      "--",
      ".",
      ":(exclude)node_modules",
      ":(exclude).git",
    ],
  );
});
