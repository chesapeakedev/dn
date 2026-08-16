// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  cleanupTestRepo,
  createTestRepo,
  runCommand,
  runDnCommand,
} from "./test_utils.ts";

async function git(args: string[], cwd: string): Promise<string> {
  const result = await runCommand(["git", ...args], { cwd });
  assertEquals(result.code, 0, result.stderr);
  return result.stdout.trim();
}

function isolatedHome(home: string): Record<string, string> {
  return { HOME: home };
}

async function createRemoteFixture(options: {
  branch?: string;
} = {}): Promise<{
  root: string;
  remote: string;
  seed: string;
  working: string;
  branch: string;
}> {
  const branch = options.branch ?? "main";
  const root = await Deno.makeTempDir({ prefix: "dn-sync-test-" });
  const remote = `${root}/remote.git`;
  const seed = `${root}/seed`;
  const working = `${root}/working`;

  await git(["init", "--bare", `--initial-branch=${branch}`, remote], root);
  await git(["init", `--initial-branch=${branch}`, seed], root);
  await git(["config", "user.name", "Test User"], seed);
  await git(["config", "user.email", "test@example.com"], seed);
  await Deno.writeTextFile(`${seed}/base.txt`, "base\n");
  await git(["add", "base.txt"], seed);
  await git(["commit", "-m", "Initial commit"], seed);
  await git(["remote", "add", "origin", remote], seed);
  await git(["push", "-u", "origin", branch], seed);

  await git(["clone", remote, working], root);
  await git(["config", "user.name", "Test User"], working);
  await git(["config", "user.email", "test@example.com"], working);

  return { root, remote, seed, working, branch };
}

Deno.test("dn sync rebases Git commits and pushes HEAD to main", async () => {
  const fixture = await createRemoteFixture();
  try {
    await git(["checkout", "-b", "feature"], fixture.working);
    await Deno.writeTextFile(`${fixture.working}/feature.txt`, "feature\n");
    await git(["add", "feature.txt"], fixture.working);
    await git(["commit", "-m", "Feature commit"], fixture.working);

    await Deno.writeTextFile(`${fixture.seed}/upstream.txt`, "upstream\n");
    await git(["add", "upstream.txt"], fixture.seed);
    await git(["commit", "-m", "Upstream commit"], fixture.seed);
    await git(["push", "origin", "main"], fixture.seed);

    const result = await runDnCommand(["sync", "--skip-preflight"], {
      cwd: fixture.working,
      env: isolatedHome(fixture.root),
    });

    assertStringIncludes(result.stdout, "detected git");
    assertStringIncludes(result.stdout, "trunk: main");
    assertStringIncludes(result.stdout, "using Git remote: origin");
    assertStringIncludes(result.stdout, "pushing local commits to origin/main");
    assertEquals(
      await git(["rev-parse", "HEAD"], fixture.working),
      await git(["rev-parse", "refs/heads/main"], fixture.remote),
    );
    assertEquals(
      await git(["show", "main:feature.txt"], fixture.remote),
      "feature",
    );
    assertEquals(
      await git(["show", "main:upstream.txt"], fixture.remote),
      "upstream",
    );

    const noChanges = await runDnCommand(["sync", "--skip-preflight"], {
      cwd: fixture.working,
      env: isolatedHome(fixture.root),
    });
    assertStringIncludes(noChanges.stdout, "skipping push");
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("dn sync uses the remote tracked by local main", async () => {
  const fixture = await createRemoteFixture();
  try {
    await git(["remote", "rename", "origin", "upstream"], fixture.working);
    await git(["checkout", "-b", "feature"], fixture.working);
    await Deno.writeTextFile(`${fixture.working}/feature.txt`, "feature\n");
    await git(["add", "feature.txt"], fixture.working);
    await git(["commit", "-m", "Feature commit"], fixture.working);

    const result = await runDnCommand(["sync", "--skip-preflight"], {
      cwd: fixture.working,
      env: isolatedHome(fixture.root),
    });

    assertStringIncludes(result.stdout, "using Git remote: upstream");
    assertEquals(
      await git(["rev-parse", "HEAD"], fixture.working),
      await git(["rev-parse", "refs/heads/main"], fixture.remote),
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("dn sync fails clearly when Git has no usable remote", async () => {
  const repo = await createTestRepo({
    initialFiles: { "readme.txt": "hello\n" },
  });
  try {
    await git(["branch", "-M", "main"], repo.path);
    const result = await runDnCommand(["sync", "--skip-preflight"], {
      cwd: repo.path,
      env: isolatedHome(repo.path),
      expectFailure: true,
    });
    assertStringIncludes(
      result.stderr,
      "no usable tracked remote and no origin remote",
    );
  } finally {
    await cleanupTestRepo(repo);
  }
});

Deno.test("dn sync skips preflight when none is configured and Makefile is absent", async () => {
  const fixture = await createRemoteFixture();
  try {
    const result = await runDnCommand(["sync"], {
      cwd: fixture.working,
      env: isolatedHome(fixture.root),
    });
    assertStringIncludes(result.stdout, "no preflight configured");
    assertStringIncludes(result.stdout, "skipping push");
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("dn sync runs configured preflight argv", async () => {
  const fixture = await createRemoteFixture();
  try {
    await Deno.writeTextFile(
      `${fixture.working}/dn.json`,
      JSON.stringify({
        schema_version: "2.0",
        sync: { preflight: [["touch", "preflight.ok"]] },
      }),
    );
    const result = await runDnCommand(["sync"], {
      cwd: fixture.working,
      env: isolatedHome(fixture.root),
    });
    assertStringIncludes(result.stdout, "preflight: touch preflight.ok");
    await Deno.stat(`${fixture.working}/preflight.ok`);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("dn sync --skip-preflight suppresses configured preflight", async () => {
  const fixture = await createRemoteFixture();
  try {
    await Deno.writeTextFile(
      `${fixture.working}/dn.json`,
      JSON.stringify({
        schema_version: "2.0",
        sync: { preflight: [["false"]] },
      }),
    );
    const result = await runDnCommand(["sync", "--skip-preflight"], {
      cwd: fixture.working,
      env: isolatedHome(fixture.root),
    });
    assertStringIncludes(result.stdout, "skipping preflight");
    assertStringIncludes(result.stdout, "skipping push");
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("dn sync publishes to a non-main default branch", async () => {
  const fixture = await createRemoteFixture({ branch: "trunk" });
  try {
    await git(["checkout", "-b", "feature"], fixture.working);
    await Deno.writeTextFile(`${fixture.working}/feature.txt`, "feature\n");
    await git(["add", "feature.txt"], fixture.working);
    await git(["commit", "-m", "Feature commit"], fixture.working);

    const result = await runDnCommand(["sync", "--skip-preflight"], {
      cwd: fixture.working,
      env: isolatedHome(fixture.root),
    });

    assertStringIncludes(result.stdout, "trunk: trunk");
    assertStringIncludes(
      result.stdout,
      "pushing local commits to origin/trunk",
    );
    assertEquals(
      await git(["show", "trunk:feature.txt"], fixture.remote),
      "feature",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});
