// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import type { DnEnsureRecipe } from "../sdk/config/types.ts";
import {
  kickstartEnsureLintFailureMessage,
  runKickstartEnsureLint,
} from "./ensureLint.ts";

Deno.test("runKickstartEnsureLint skips when ensure.lint is absent", async () => {
  const outcome = await runKickstartEnsureLint({
    workspaceRoot: "/tmp/repo",
    agent: "opencode",
    resolveConfig: () => Promise.resolve({}),
    runRecipe: () => {
      throw new Error("should not run");
    },
  });
  assertEquals(outcome, { status: "skipped", reason: "missing_recipe" });
});

Deno.test("runKickstartEnsureLint skips when ensure exists without lint", async () => {
  const outcome = await runKickstartEnsureLint({
    workspaceRoot: "/tmp/repo",
    agent: "opencode",
    resolveConfig: () =>
      Promise.resolve({
        ensure: {
          tests: {
            argv: ["make", "tests"],
            intent: "Fix tests.",
          },
        },
      }),
    runRecipe: () => {
      throw new Error("should not run tests");
    },
  });
  assertEquals(outcome, { status: "skipped", reason: "missing_recipe" });
});

Deno.test("runKickstartEnsureLint runs lint with fixer and reports pass", async () => {
  let ran: { name: string; recipe: DnEnsureRecipe; noFix: boolean } | undefined;
  const outcome = await runKickstartEnsureLint({
    workspaceRoot: "/tmp/repo",
    agent: "codex",
    resolveConfig: () =>
      Promise.resolve({
        ensure: {
          lint: {
            argv: ["make", "lint"],
            intent: "Fix lint.",
          },
        },
      }),
    runRecipe: (options) => {
      ran = {
        name: options.name,
        recipe: options.recipe,
        noFix: options.noFix,
      };
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
  });
  assertEquals(outcome, { status: "passed" });
  assertEquals(ran?.name, "lint");
  assertEquals(ran?.recipe.argv, ["make", "lint"]);
  assertEquals(ran?.noFix, false);
});

Deno.test("runKickstartEnsureLint reports failure after the fixer loop", async () => {
  const outcome = await runKickstartEnsureLint({
    workspaceRoot: "/tmp/repo",
    agent: "opencode",
    resolveConfig: () =>
      Promise.resolve({
        ensure: {
          lint: { argv: ["false"], intent: "Fix lint." },
        },
      }),
    runRecipe: () => Promise.resolve({ code: 2, stdout: "", stderr: "nope" }),
  });
  assertEquals(outcome, { status: "failed", code: 2 });
  assertEquals(
    kickstartEnsureLintFailureMessage(2),
    "ensure lint failed with exit code 2. Kickstart will not open a PR or leave work ready to land until lint passes.",
  );
});
