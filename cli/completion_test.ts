// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import {
  bashCompletionScript,
  completeWords,
  DN_COMPLETION_ROOT,
  zshCompletionScript,
} from "./completion.ts";
import { runDnCommand } from "./test_utils.ts";

Deno.test("completeWords offers top-level commands for an empty prefix", () => {
  const matches = completeWords(["dn", ""]);
  assert(matches.includes("kickstart"));
  assert(matches.includes("loop"));
  assert(matches.includes("rfc"));
  assert(matches.includes("ensure"));
  assert(matches.includes("completion"));
  assertEquals(matches.includes("__complete"), false);
});

Deno.test("completeWords filters top-level commands by prefix", () => {
  assertEquals(completeWords(["dn", "ki"]), ["kickstart"]);
});

Deno.test("completeWords offers ensure recipe names", () => {
  assertEquals(
    completeWords(["dn", "ensure", ""], DN_COMPLETION_ROOT, {
      ensureRecipes: ["lint", "tests"],
    }),
    ["lint", "tests"],
  );
  assertEquals(
    completeWords(["dn", "ensure", "li"], DN_COMPLETION_ROOT, {
      ensureRecipes: ["lint", "tests"],
    }),
    ["lint"],
  );
});

Deno.test("completeWords offers nested rfc subcommands", () => {
  const matches = completeWords(["dn", "rfc", ""]);
  assertEquals(
    matches,
    ["complete", "create", "init", "list", "show", "status"],
  );
});

Deno.test("completeWords offers nested init subcommands by prefix", () => {
  const matches = completeWords(["dn", "init", "w"]);
  assertEquals(matches, ["wizard", "workflows"]);
});

Deno.test("completeWords skips global flags before the subcommand", () => {
  assertEquals(completeWords(["dn", "--unattended", "ki"]), ["kickstart"]);
});

Deno.test("completeWords skips --context-file values before the subcommand", () => {
  assertEquals(
    completeWords(["dn", "--context-file", "notes.md", "ki"]),
    ["kickstart"],
  );
});

Deno.test("completeWords offers --agent harness values", () => {
  assertEquals(
    completeWords(["dn", "--agent", ""]),
    ["claude", "codex", "copilot", "cursor", "opencode"],
  );
  assertEquals(completeWords(["dn", "--agent", "co"]), ["codex", "copilot"]);
});

Deno.test("completeWords offers --agent= values", () => {
  assertEquals(
    completeWords(["dn", "--agent=c"]),
    ["--agent=claude", "--agent=codex", "--agent=copilot", "--agent=cursor"],
  );
});

Deno.test("completeWords offers --agent after a subcommand", () => {
  assertEquals(
    completeWords(["dn", "kickstart", "--agent", ""]),
    ["claude", "codex", "copilot", "cursor", "opencode"],
  );
});

Deno.test("completeWords offers flags after a subcommand", () => {
  const matches = completeWords(["dn", "kickstart", "--"]);
  assert(matches.includes("--awp"));
  assert(matches.includes("--help"));
  assert(matches.includes("--unattended"));
  assert(matches.includes("--agent"));
  assert(!matches.includes("--codex"));
  assert(!matches.includes("--cursor"));
});

Deno.test("completeWords offers rfc --status values", () => {
  assertEquals(
    completeWords(["dn", "rfc", "list", "--status", ""]),
    [
      "accepted",
      "done",
      "draft",
      "implementing",
      "review",
      "superseded",
    ],
  );
});

Deno.test("completeWords returns nothing for positional paths", () => {
  assertEquals(completeWords(["dn", "loop", "plans/"]), []);
});

Deno.test("completeWords treats a trailing space as an empty prefix", () => {
  assertEquals(completeWords(["dn", "rfc"]), ["rfc"]);
  assert(completeWords(["dn", "rfc", ""]).includes("create"));
});

Deno.test("bash completion script registers a default-fallback function", () => {
  const script = bashCompletionScript();
  assert(script.includes("complete -o default -F _dn dn"));
  assert(script.includes("__complete --"));
});

Deno.test("zsh completion script registers compdef and file fallback", () => {
  const script = zshCompletionScript();
  assert(script.includes("compdef _dn dn"));
  assert(script.includes("__complete --"));
  assert(script.includes("_files"));
});

Deno.test("dn completion bash prints a sourcable script", async () => {
  const result = await runDnCommand(["completion", "bash"]);
  assert(result.stdout.includes("complete -o default -F _dn dn"));
});

Deno.test("dn __complete prints command candidates", async () => {
  const result = await runDnCommand(["__complete", "--", "dn", "rfc", ""]);
  const lines = result.stdout.trim().split("\n");
  assertEquals(
    lines,
    ["complete", "create", "init", "list", "show", "status"],
  );
});

Deno.test("dn __complete keeps bootstrap flags on the completed line", async () => {
  const result = await runDnCommand([
    "__complete",
    "--",
    "dn",
    "--unattended",
    "ki",
  ]);
  assertEquals(result.stdout.trim(), "kickstart");
});
