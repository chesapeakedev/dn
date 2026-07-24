// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  inspectRunnerRepository,
  repositorySlugFromRemote,
  type RunnerCommandProbe,
} from "./doctor.ts";

Deno.test("repositorySlugFromRemote supports GitHub HTTPS and SSH remotes", () => {
  assertEquals(
    repositorySlugFromRemote("https://github.com/chesapeakedev/dn.git"),
    "chesapeakedev/dn",
  );
  assertEquals(
    repositorySlugFromRemote("git@github.com:chesapeakedev/dn.git"),
    "chesapeakedev/dn",
  );
  assertEquals(
    repositorySlugFromRemote("ssh://git@github.com/chesapeakedev/dn"),
    "chesapeakedev/dn",
  );
});

Deno.test("inspectRunnerRepository prefers Sapling and never returns the path", async () => {
  const checkout = await Deno.makeTempDir({ prefix: "dn-runner-sl-" });
  try {
    await Deno.mkdir(`${checkout}/.sl`);
    const calls: string[] = [];
    const probe: RunnerCommandProbe = {
      run(command, args, cwd) {
        calls.push(`${command} ${args.join(" ")} ${cwd}`);
        return Promise.resolve({
          success: true,
          stdout: "default = https://github.com/chesapeakedev/dn.git",
          stderr: "",
        });
      },
    };
    assertEquals(await inspectRunnerRepository(checkout, probe), {
      repository: "chesapeakedev/dn",
      vcs: "sl",
    });
    assertEquals(calls.length, 1);
  } finally {
    await Deno.remove(checkout, { recursive: true });
  }
});

Deno.test("inspectRunnerRepository rejects directories without VCS metadata", async () => {
  const checkout = await Deno.makeTempDir({ prefix: "dn-runner-empty-" });
  try {
    await assertRejects(
      () => inspectRunnerRepository(checkout),
      Error,
      "No .sl or .git",
    );
  } finally {
    await Deno.remove(checkout, { recursive: true });
  }
});
