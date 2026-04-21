// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runDnCommand } from "./test_utils.ts";

async function createContextFixture(): Promise<{
  root: string;
  repoPath: string;
  codexHome: string;
}> {
  const root = await Deno.makeTempDir({ prefix: "dn-context-" });
  const repoPath = join(root, "repo");
  const codexHome = join(root, "codex-home");

  await Deno.mkdir(join(repoPath, ".sl"), { recursive: true });
  await Deno.mkdir(join(repoPath, "nested", "deep"), { recursive: true });
  await Deno.mkdir(codexHome, { recursive: true });

  await Deno.writeTextFile(join(codexHome, "AGENTS.md"), "global guidance");
  await Deno.writeTextFile(join(repoPath, "AGENTS.md"), "repo root guidance");
  await Deno.writeTextFile(
    join(repoPath, "nested", "AGENTS.md"),
    "nested guidance",
  );
  await Deno.writeTextFile(
    join(repoPath, "nested", "deep", "AGENTS.override.md"),
    "deep override guidance",
  );
  await Deno.writeTextFile(
    join(repoPath, "nested", "deep", "target.ts"),
    "export {};\n",
  );

  return {
    root,
    repoPath: await Deno.realPath(repoPath),
    codexHome: await Deno.realPath(codexHome),
  };
}

Deno.test("context check shows help", async () => {
  const fixture = await createContextFixture();

  try {
    const result = await runDnCommand(["context", "check", "--help"], {
      cwd: fixture.repoPath,
      env: {
        CODEX_HOME: fixture.codexHome,
      },
    });

    assert(result.stdout.includes("dn context"));
    assert(result.stdout.includes("--claude-tokens"));
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("context check discovers inherited AGENTS files in order", async () => {
  const fixture = await createContextFixture();

  try {
    const result = await runDnCommand([
      "context",
      "check",
      "nested/deep/target.ts",
      "--json",
    ], {
      cwd: fixture.repoPath,
      env: {
        CODEX_HOME: fixture.codexHome,
      },
    });

    const parsed = JSON.parse(result.stdout);

    assertEquals(parsed.projectRoot, fixture.repoPath);
    assertEquals(
      parsed.sources.map((source: { path: string }) => source.path),
      [
        join(fixture.codexHome, "AGENTS.md"),
        join(fixture.repoPath, "AGENTS.md"),
        join(fixture.repoPath, "nested", "AGENTS.md"),
        join(fixture.repoPath, "nested", "deep", "AGENTS.override.md"),
      ],
    );
    assertEquals(parsed.includedSources, [
      join(fixture.codexHome, "AGENTS.md"),
      join(fixture.repoPath, "AGENTS.md"),
      join(fixture.repoPath, "nested", "AGENTS.md"),
      join(fixture.repoPath, "nested", "deep", "AGENTS.override.md"),
    ]);
    assertEquals(parsed.truncated, false);
    assert(
      parsed.fullContext.includes("global guidance\n\nrepo root guidance"),
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("context check skips empty files and stops at the byte limit", async () => {
  const fixture = await createContextFixture();

  try {
    await Deno.writeTextFile(
      join(fixture.codexHome, "AGENTS.override.md"),
      "   \n",
    );
    await Deno.writeTextFile(
      join(fixture.repoPath, "nested", "AGENTS.override.md"),
      "   \n",
    );

    const result = await runDnCommand([
      "context",
      "check",
      "nested/deep/target.ts",
      "--json",
      "--max-bytes",
      "40",
    ], {
      cwd: fixture.repoPath,
      env: {
        CODEX_HOME: fixture.codexHome,
      },
    });

    const parsed = JSON.parse(result.stdout);

    assertEquals(parsed.includedSources, [
      join(fixture.codexHome, "AGENTS.md"),
      join(fixture.repoPath, "AGENTS.md"),
    ]);
    assertEquals(parsed.omittedSources, [
      join(fixture.repoPath, "nested", "AGENTS.md"),
      join(fixture.repoPath, "nested", "deep", "AGENTS.override.md"),
    ]);
    assertEquals(parsed.truncated, true);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("context check reports sizes in kilobytes with byte counts", async () => {
  const fixture = await createContextFixture();

  try {
    const result = await runDnCommand([
      "context",
      "check",
      "nested/deep/target.ts",
    ], {
      cwd: fixture.repoPath,
      env: {
        CODEX_HOME: fixture.codexHome,
      },
    });

    assert(result.stdout.includes("Max size: 32 KB (32,768 bytes)"));
    assert(result.stdout.includes("Full context: 0.07 KB (76 bytes)"));
    assert(result.stdout.includes("Included: 0.07 KB (76 bytes)"));
    assert(
      result.stdout.includes(
        `${
          join(fixture.codexHome, "AGENTS.md")
        } (0.01 KB (15 bytes), included)`,
      ),
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});
