// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { buildClaudeExecArgs } from "./claudeAgent.ts";
import { buildCodexExecArgs } from "./codexAgent.ts";
import { buildCopilotExecArgs } from "./copilotAgent.ts";
import { buildCursorAgentArgs } from "./cursorAgent.ts";
import { buildOpenCodeRunArgs } from "./opencode.ts";

Deno.test("buildOpenCodeRunArgs adds --model without --variant for two-part specs", () => {
  assertEquals(
    buildOpenCodeRunArgs("plan", "/tmp/prompt.md", {
      model: "openrouter/openai/gpt-5.6-luna",
    }),
    [
      "run",
      "plan",
      "-f",
      "/tmp/prompt.md",
      "--log-level=DEBUG",
      "--model",
      "openrouter/openai/gpt-5.6-luna",
    ],
  );
});

Deno.test("buildOpenCodeRunArgs adds --variant only when thinking is set", () => {
  assertEquals(
    buildOpenCodeRunArgs("implement", "/tmp/prompt.md", {
      model: "openrouter/openai/gpt-5.6-luna",
      thinking: "high",
    }),
    [
      "run",
      "implement",
      "-f",
      "/tmp/prompt.md",
      "--log-level=DEBUG",
      "--model",
      "openrouter/openai/gpt-5.6-luna",
      "--variant",
      "high",
    ],
  );
});

Deno.test("buildCodexExecArgs adds --model without reasoning effort for two-part specs", () => {
  assertEquals(
    buildCodexExecArgs("/work/repo", "Run the plan", { model: "gpt-5.4" }),
    [
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/work/repo",
      "--model",
      "gpt-5.4",
      "Run the plan",
    ],
  );
});

Deno.test("buildCodexExecArgs adds model_reasoning_effort when thinking is set", () => {
  assertEquals(
    buildCodexExecArgs("/work/repo", "Run the plan", {
      model: "gpt-5.4",
      thinking: "high",
    }),
    [
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/work/repo",
      "--model",
      "gpt-5.4",
      "-c",
      "model_reasoning_effort=high",
      "Run the plan",
    ],
  );
});

Deno.test("buildClaudeExecArgs adds --model without --effort for two-part specs", () => {
  const previousBare = Deno.env.get("CLAUDE_CODE_BARE");
  const previousSkip = Deno.env.get("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS");
  const previousTools = Deno.env.get("CLAUDE_ALLOWED_TOOLS");
  const previousMode = Deno.env.get("CLAUDE_PERMISSION_MODE");
  try {
    Deno.env.delete("CLAUDE_CODE_BARE");
    Deno.env.delete("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS");
    Deno.env.delete("CLAUDE_ALLOWED_TOOLS");
    Deno.env.delete("CLAUDE_PERMISSION_MODE");
    assertEquals(
      buildClaudeExecArgs("Run the plan", { model: "opus" }),
      [
        "-p",
        "Run the plan",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Bash,Read,Edit",
        "--model",
        "opus",
      ],
    );
  } finally {
    if (previousBare === undefined) Deno.env.delete("CLAUDE_CODE_BARE");
    else Deno.env.set("CLAUDE_CODE_BARE", previousBare);
    if (previousSkip === undefined) {
      Deno.env.delete("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS");
    } else Deno.env.set("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS", previousSkip);
    if (previousTools === undefined) Deno.env.delete("CLAUDE_ALLOWED_TOOLS");
    else Deno.env.set("CLAUDE_ALLOWED_TOOLS", previousTools);
    if (previousMode === undefined) Deno.env.delete("CLAUDE_PERMISSION_MODE");
    else Deno.env.set("CLAUDE_PERMISSION_MODE", previousMode);
  }
});

Deno.test("buildClaudeExecArgs adds --effort only when thinking is set", () => {
  const previousBare = Deno.env.get("CLAUDE_CODE_BARE");
  const previousSkip = Deno.env.get("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS");
  const previousTools = Deno.env.get("CLAUDE_ALLOWED_TOOLS");
  const previousMode = Deno.env.get("CLAUDE_PERMISSION_MODE");
  try {
    Deno.env.delete("CLAUDE_CODE_BARE");
    Deno.env.delete("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS");
    Deno.env.delete("CLAUDE_ALLOWED_TOOLS");
    Deno.env.delete("CLAUDE_PERMISSION_MODE");
    assertEquals(
      buildClaudeExecArgs("Run the plan", { model: "opus", thinking: "high" }),
      [
        "-p",
        "Run the plan",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Bash,Read,Edit",
        "--model",
        "opus",
        "--effort",
        "high",
      ],
    );
  } finally {
    if (previousBare === undefined) Deno.env.delete("CLAUDE_CODE_BARE");
    else Deno.env.set("CLAUDE_CODE_BARE", previousBare);
    if (previousSkip === undefined) {
      Deno.env.delete("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS");
    } else Deno.env.set("CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS", previousSkip);
    if (previousTools === undefined) Deno.env.delete("CLAUDE_ALLOWED_TOOLS");
    else Deno.env.set("CLAUDE_ALLOWED_TOOLS", previousTools);
    if (previousMode === undefined) Deno.env.delete("CLAUDE_PERMISSION_MODE");
    else Deno.env.set("CLAUDE_PERMISSION_MODE", previousMode);
  }
});

Deno.test("buildCursorAgentArgs adds --model and has no thinking flag", () => {
  assertEquals(
    buildCursorAgentArgs("Run the plan", { model: "gpt-5" }),
    ["-p", "--force", "--model", "gpt-5", "Run the plan"],
  );
});

Deno.test("buildCopilotExecArgs adds --model and has no thinking flag", () => {
  assertEquals(
    buildCopilotExecArgs("Run the plan", { model: "gpt-5" }),
    [
      "-p",
      "Run the plan",
      "-s",
      "--no-ask-user",
      "--allow-tool=write, shell(deno:*), shell(make:*), shell(sl:*)",
      "--model",
      "gpt-5",
    ],
  );
});
