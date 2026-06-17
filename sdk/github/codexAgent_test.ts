// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { buildCodexExecArgs } from "./codexAgent.ts";

Deno.test("buildCodexExecArgs uses current Codex sandbox and repo-check flags", () => {
  assertEquals(
    buildCodexExecArgs(
      "/work/repo",
      "Read and execute the instructions in this file: /tmp/prompt.md",
    ),
    [
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/work/repo",
      "Read and execute the instructions in this file: /tmp/prompt.md",
    ],
  );
});
