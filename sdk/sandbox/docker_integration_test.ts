// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { DockerRunner } from "./dockerRunner.ts";
import { isDockerAvailable, isDockerDaemonAvailable } from "./prerequisites.ts";

Deno.test("DockerRunner integration smoke test", async () => {
  if (!(await isDockerAvailable()) || !(await isDockerDaemonAvailable())) {
    console.log("Skipping Docker integration test: docker unavailable");
    return;
  }

  const runner = new DockerRunner();
  const ctx = {
    repoRoot: Deno.cwd(),
    dryRun: false,
    config: {
      provider: "docker" as const,
      workspace: "/workspace",
      sync: { mode: "bind" as const, exclude: [] },
      docker: {
        image: "denoland/deno:alpine-2.6.3",
        network: "none" as const,
        read_only_root: false,
        mounts: [{ source: ".", target: "/workspace" }],
        env_pass_through: [],
      },
      exe_dev: {
        image: "exeuntu",
        vm_name_prefix: "dn-kickstart",
        ttl: "4h",
        integrations: [],
      },
    },
  };

  const handle = await runner.provision(ctx);
  try {
    const result = await runner.exec(handle, ["deno", "--version"], {
      cwd: Deno.cwd(),
    });
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "deno");
  } finally {
    await runner.teardown(handle);
  }
});
