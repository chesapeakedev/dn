// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import { cleanupTestRepo, createTestRepo, runDnCommand } from "./test_utils.ts";

const EXISTING_AGENTS_MD = `# AGENTS.md

## Project Overview

- Runtime: Deno
- Build output: CLI
- Package management: native Deno imports
- Goal: validate init-agents idempotency in a temp repository

## Build

Run the normal project checks before landing changes. Prefer repository tasks over ad hoc commands.

## Testing Guidelines

Tests should be deterministic and isolated. Prefer behavior-focused tests over implementation details. When changing user-visible behavior, add or update tests close to the affected area.

## Custom Notes

Keep diffs small, preserve local conventions, and avoid unrelated refactors.
`;

Deno.test("init agents is idempotent for an existing non-minimal AGENTS.md", async () => {
  const testRepo = await createTestRepo({
    initialFiles: {
      "AGENTS.md": EXISTING_AGENTS_MD,
    },
  });

  try {
    const firstRun = await runDnCommand(["init", "agents"], {
      cwd: testRepo.path,
    });
    const firstContent = await Deno.readTextFile(`${testRepo.path}/AGENTS.md`);

    const secondRun = await runDnCommand(["init", "agents"], {
      cwd: testRepo.path,
    });
    const secondContent = await Deno.readTextFile(`${testRepo.path}/AGENTS.md`);

    assert(firstRun.stdout.includes("Updated"));
    assert(secondRun.stdout.includes("Updated"));
    assertEquals(secondContent, firstContent);
    assertEquals(secondContent.match(/^## Using dn$/gm)?.length ?? 0, 1);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
