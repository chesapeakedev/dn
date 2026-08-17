// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  DN_ENSURE_ACTIVE_ENV,
  execRecipeArgv,
  formatFixerPrompt,
  isEnsureActive,
  loadEnsureRecipeNames,
  parseEnsureArgs,
  runEnsureRecipe,
} from "./ensure.ts";
import { cleanupTestRepo, createTestRepo, runDnCommand } from "./test_utils.ts";

function ensureConfig(
  recipes: Record<
    string,
    { argv: string[]; intent: string; iterations?: number }
  >,
): string {
  return JSON.stringify({
    schema_version: "2.0",
    agent: "opencode",
    ensure: recipes,
  });
}

Deno.test("parseEnsureArgs lists with no name and rejects extra argv", () => {
  assertEquals(parseEnsureArgs([]).name, null);
  assertEquals(parseEnsureArgs(["lint"]).name, "lint");
  assertEquals(parseEnsureArgs(["lint", "--no-fix"]).noFix, true);
  assertEquals(parseEnsureArgs(["--no-fix", "lint"]).name, "lint");
  try {
    parseEnsureArgs(["lint", "--oops"]);
    throw new Error("expected throw");
  } catch (error) {
    assertStringIncludes(
      error instanceof Error ? error.message : String(error),
      "Unknown ensure option",
    );
  }
  try {
    parseEnsureArgs(["lint", "extra"]);
    throw new Error("expected throw");
  } catch (error) {
    assertStringIncludes(
      error instanceof Error ? error.message : String(error),
      "does not accept extra arguments",
    );
  }
});

Deno.test("isEnsureActive reads DN_ENSURE_ACTIVE", () => {
  assertEquals(isEnsureActive({}), false);
  assertEquals(isEnsureActive({ [DN_ENSURE_ACTIVE_ENV]: "1" }), true);
  assertEquals(isEnsureActive({ [DN_ENSURE_ACTIVE_ENV]: "true" }), true);
  assertEquals(isEnsureActive({ [DN_ENSURE_ACTIVE_ENV]: "0" }), false);
});

Deno.test("dn ensure --help exits zero", async () => {
  const result = await runDnCommand(["ensure", "--help"]);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "dn ensure");
  assertStringIncludes(result.stdout, "--no-fix");
});

Deno.test("dn ensure lists recipes from dn.json", async () => {
  const repo = await createTestRepo({
    initialFiles: {
      "dn.json": ensureConfig({
        tests: { argv: ["make", "tests"], intent: "Fix tests." },
        lint: { argv: ["make", "lint"], intent: "Fix lint." },
      }),
    },
  });
  try {
    const result = await runDnCommand(["ensure"], { cwd: repo.path });
    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "lint");
    assertStringIncludes(result.stdout, "argv: make lint");
    assertStringIncludes(result.stdout, "tests");
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("dn ensure errors when ensure block is missing", async () => {
  const repo = await createTestRepo({
    initialFiles: {
      "dn.json": JSON.stringify({ schema_version: "2.0", agent: "opencode" }),
    },
  });
  try {
    const result = await runDnCommand(["ensure"], {
      cwd: repo.path,
      expectFailure: true,
    });
    assertStringIncludes(result.stderr, "No ensure recipes");
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("dn ensure errors on unknown recipe names", async () => {
  const repo = await createTestRepo({
    initialFiles: {
      "dn.json": ensureConfig({
        lint: { argv: ["true"], intent: "noop" },
      }),
    },
  });
  try {
    const result = await runDnCommand(["ensure", "missing"], {
      cwd: repo.path,
      expectFailure: true,
    });
    assertStringIncludes(result.stderr, 'Unknown ensure recipe "missing"');
    assertStringIncludes(result.stderr, '"lint"');
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("dn ensure rejects extra arguments after the recipe name", async () => {
  const repo = await createTestRepo({
    initialFiles: {
      "dn.json": ensureConfig({
        lint: { argv: ["true"], intent: "noop" },
      }),
    },
  });
  try {
    const unknownFlag = await runDnCommand(["ensure", "lint", "--release"], {
      cwd: repo.path,
      expectFailure: true,
    });
    assertStringIncludes(unknownFlag.stderr, "Unknown ensure option");
    const extraPositional = await runDnCommand(["ensure", "lint", "extra"], {
      cwd: repo.path,
      expectFailure: true,
    });
    assertStringIncludes(
      extraPositional.stderr,
      "does not accept extra arguments",
    );
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("dn ensure runs a successful recipe without an agent", async () => {
  const repo = await createTestRepo({
    initialFiles: {
      "dn.json": ensureConfig({
        ok: { argv: ["true"], intent: "always passes" },
      }),
    },
  });
  try {
    const result = await runDnCommand(["ensure", "ok"], { cwd: repo.path });
    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "ok:");
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("dn ensure --no-fix fails after one exec", async () => {
  const repo = await createTestRepo({
    initialFiles: {
      "dn.json": ensureConfig({
        fail: { argv: ["false"], intent: "always fails", iterations: 4 },
      }),
    },
  });
  try {
    const result = await runDnCommand(["ensure", "fail", "--no-fix"], {
      cwd: repo.path,
      expectFailure: true,
    });
    assertEquals(result.code !== 0, true);
    assertStringIncludes(result.stderr, "--no-fix");
    assertEquals(result.stdout.includes("fixer agent"), false);
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("dn ensure nested DN_ENSURE_ACTIVE is passthrough", async () => {
  const repo = await createTestRepo({
    initialFiles: {
      "dn.json": ensureConfig({
        fail: { argv: ["false"], intent: "always fails" },
      }),
    },
  });
  try {
    const result = await runDnCommand(["ensure", "fail"], {
      cwd: repo.path,
      expectFailure: true,
      env: { [DN_ENSURE_ACTIVE_ENV]: "1" },
    });
    assertEquals(result.code !== 0, true);
    assertStringIncludes(result.stderr, "DN_ENSURE_ACTIVE");
    assertEquals(result.stdout.includes("fixer agent"), false);
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("runEnsureRecipe retries after a fixer until the gate passes", async () => {
  let execs = 0;
  let fixes = 0;
  const capture = await runEnsureRecipe({
    name: "lint",
    recipe: {
      argv: ["make", "lint"],
      intent: "Fix lint.",
      iterations: 5,
    },
    workspaceRoot: Deno.cwd(),
    noFix: false,
    nested: false,
    agent: "opencode",
    exec: () => {
      execs += 1;
      if (execs === 1) {
        return Promise.resolve({ code: 1, stdout: "boom", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
    },
    runFixer: () => {
      fixes += 1;
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
  });
  assertEquals(capture.code, 0);
  assertEquals(execs, 2);
  assertEquals(fixes, 1);
});

Deno.test("formatFixerPrompt tells the agent not to invoke dn ensure", () => {
  const prompt = formatFixerPrompt(
    "lint",
    { argv: ["make", "lint"], intent: "Fix lint failures." },
    { code: 1, stdout: "error", stderr: "" },
  );
  assertStringIncludes(prompt, "Do **not** invoke `dn ensure`");
  assertStringIncludes(prompt, "make lint");
  assertStringIncludes(prompt, "Fix lint failures.");
});

Deno.test("loadEnsureRecipeNames walks up to dn.json", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-ensure-names-" });
  try {
    await Deno.writeTextFile(
      join(root, "dn.json"),
      ensureConfig({
        lint: { argv: ["true"], intent: "x" },
        tests: { argv: ["true"], intent: "y" },
      }),
    );
    await Deno.mkdir(join(root, "nested"));
    assertEquals(loadEnsureRecipeNames(join(root, "nested")), [
      "lint",
      "tests",
    ]);
    assertEquals(loadEnsureRecipeNames(root), ["lint", "tests"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("execRecipeArgv captures a failing command", async () => {
  const result = await execRecipeArgv(["false"], Deno.cwd());
  assertEquals(result.code !== 0, true);
});
