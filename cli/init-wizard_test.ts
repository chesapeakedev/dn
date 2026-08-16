// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parseDnConfig } from "../sdk/config/parse.ts";
import { buildStrictConfig } from "./init-wizard.ts";
import {
  cleanupTestRepo,
  createTestRepo,
  runDnCommand,
  type TestRepo,
} from "./test_utils.ts";

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
}

Deno.test("init wizard --help exits zero", async () => {
  const result = await runDnCommand(["init", "wizard", "--help"]);
  assert(result.success);
  assert(result.stdout.includes("dn init wizard"));
  assert(result.stdout.includes("--project"));
  assert(result.stdout.includes("--user"));
});

Deno.test("init wizard --project --yes writes dn.json in repo", async () => {
  let repo: TestRepo | undefined;
  try {
    repo = await createTestRepo();
    const result = await runDnCommand(
      ["init", "wizard", "--project", "--yes", "--json"],
      { cwd: repo.path },
    );
    assert(result.success, result.stderr);

    const config = await readJson(join(repo.path, "dn.json"));
    assertEquals(config.schema_version, "2.0");
    assertEquals(config.agent, "opencode");
    assertEquals((config.sandbox as { provider: string }).provider, "none");
    assertEquals(config.strict, undefined);
  } finally {
    if (repo) await cleanupTestRepo(repo);
  }
});

Deno.test("init wizard --yes preserves require_rfcs and drops bare enabled", async () => {
  let repo: TestRepo | undefined;
  try {
    repo = await createTestRepo();
    await Deno.writeTextFile(
      join(repo.path, "dn.json"),
      `${
        JSON.stringify(
          {
            schema_version: "2.0",
            agent: "opencode",
            strict: { enabled: true, require_rfcs: true },
          },
          null,
          2,
        )
      }\n`,
    );
    const keep = await runDnCommand(
      ["init", "wizard", "--project", "--yes", "--json"],
      { cwd: repo.path },
    );
    assert(keep.success, keep.stderr);
    assertEquals(
      (await readJson(join(repo.path, "dn.json"))).strict,
      { enabled: true, require_rfcs: true },
    );

    await Deno.writeTextFile(
      join(repo.path, "dn.json"),
      `${
        JSON.stringify(
          {
            schema_version: "2.0",
            agent: "opencode",
            strict: { enabled: true },
          },
          null,
          2,
        )
      }\n`,
    );
    const drop = await runDnCommand(
      ["init", "wizard", "--project", "--yes", "--json"],
      { cwd: repo.path },
    );
    assert(drop.success, drop.stderr);
    assertEquals(
      (await readJson(join(repo.path, "dn.json"))).strict,
      undefined,
    );
  } finally {
    if (repo) await cleanupTestRepo(repo);
  }
});

Deno.test("buildStrictConfig derives enabled from require_rfcs", () => {
  assertEquals(buildStrictConfig(false, undefined), undefined);
  assertEquals(buildStrictConfig(false, { enabled: true }), undefined);
  assertEquals(
    buildStrictConfig(true, undefined),
    { enabled: true, require_rfcs: true },
  );
  assertEquals(
    buildStrictConfig(true, { enabled: false }),
    { enabled: true, require_rfcs: true },
  );
});
Deno.test("init wizard --user --yes writes ~/.dn/config.json defaults", async () => {
  const home = await Deno.makeTempDir({ prefix: "dn-wizard-home-" });
  const outside = await Deno.makeTempDir({ prefix: "dn-wizard-cwd-" });
  const configPath = join(home, ".dn", "config.json");
  try {
    const result = await runDnCommand(
      ["init", "wizard", "--user", "--yes", "--json"],
      { cwd: outside, env: { HOME: home } },
    );
    assert(result.success, result.stderr);
    assert(
      !result.stderr.includes("not inside a repository"),
      `unexpected VCS noise: ${result.stderr}`,
    );
    assert(
      !result.stderr.includes("not a git repository"),
      `unexpected VCS noise: ${result.stderr}`,
    );

    const config = parseDnConfig(
      await Deno.readTextFile(configPath),
      configPath,
    );
    assertEquals(config.schema_version, "2.0");
    assertEquals(config.defaults?.agent, "opencode");
    assertEquals(config.defaults?.sandbox?.provider, "none");
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("init wizard auto-detects project mode inside git repo", async () => {
  let repo: TestRepo | undefined;
  try {
    repo = await createTestRepo();
    const result = await runDnCommand(["init", "wizard", "--yes"], {
      cwd: repo.path,
    });
    assert(result.success, result.stderr);
    assert(result.stdout.includes("Project setup"));
    await Deno.stat(join(repo.path, "dn.json"));
  } finally {
    if (repo) await cleanupTestRepo(repo);
  }
});

Deno.test("init wizard auto-detects user mode outside repo", async () => {
  const home = await Deno.makeTempDir({ prefix: "dn-wizard-outside-" });
  const outside = await Deno.makeTempDir({ prefix: "dn-wizard-cwd-" });
  try {
    const result = await runDnCommand(["init", "wizard", "--yes"], {
      cwd: outside,
      env: { HOME: home },
    });
    assert(result.success, result.stderr);
    assert(result.stdout.includes("User setup"));
    assert(
      !result.stderr.includes("not inside a repository"),
      `unexpected VCS noise: ${result.stderr}`,
    );
    assert(
      !result.stderr.includes("not a git repository"),
      `unexpected VCS noise: ${result.stderr}`,
    );
    await Deno.stat(join(home, ".dn", "config.json"));
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("init wizard --project fails outside repo", async () => {
  const outside = await Deno.makeTempDir({ prefix: "dn-wizard-no-vcs-" });
  try {
    const result = await runDnCommand(["init", "wizard", "--project"], {
      cwd: outside,
      expectFailure: true,
    });
    assert(!result.success);
    assert(result.stderr.includes("Project mode requires"));
  } finally {
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("init wizard projects .github/dn/config.json after write", async () => {
  let repo: TestRepo | undefined;
  try {
    repo = await createTestRepo();
    const result = await runDnCommand(
      ["init", "wizard", "--project", "--yes"],
      { cwd: repo.path },
    );
    assert(result.success, result.stderr);

    const bridge = parseDnConfig(
      await Deno.readTextFile(join(repo.path, ".github/dn/config.json")),
      ".github/dn/config.json",
    );
    assertEquals(bridge.agent, "opencode");
  } finally {
    if (repo) await cleanupTestRepo(repo);
  }
});
