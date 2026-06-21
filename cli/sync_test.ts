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

async function createRemoteFixture(): Promise<{
  root: string;
  remote: string;
  seed: string;
  working: string;
}> {
  const root = await Deno.makeTempDir({ prefix: "dn-sync-test-" });
  const remote = `${root}/remote.git`;
  const seed = `${root}/seed`;
  const working = `${root}/working`;

  await git(["init", "--bare", "--initial-branch=main", remote], root);
  await git(["init", "--initial-branch=main", seed], root);
  await git(["config", "user.name", "Test User"], seed);
  await git(["config", "user.email", "test@example.com"], seed);
  await Deno.writeTextFile(`${seed}/base.txt`, "base\n");
  await git(["add", "base.txt"], seed);
  await git(["commit", "-m", "Initial commit"], seed);
  await git(["remote", "add", "origin", remote], seed);
  await git(["push", "-u", "origin", "main"], seed);

  await git(["clone", remote, working], root);
  await git(["config", "user.name", "Test User"], working);
  await git(["config", "user.email", "test@example.com"], working);

  return { root, remote, seed, working };
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

    const result = await runDnCommand(["sync", "--skip-lint"], {
      cwd: fixture.working,
    });

    assertStringIncludes(result.stdout, "detected git");
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

    const noChanges = await runDnCommand(["sync", "--skip-lint"], {
      cwd: fixture.working,
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

    const result = await runDnCommand(["sync", "--skip-lint"], {
      cwd: fixture.working,
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
  const repo = await createTestRepo();
  try {
    const result = await runDnCommand(["sync", "--skip-lint"], {
      cwd: repo.path,
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
