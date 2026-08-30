// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureCloudCheckout } from "./cloudCheckout.ts";
import { getRunnerConfigPaths, loadRunnerConfig } from "./config.ts";

Deno.test("ensureCloudCheckout clones then fetch-resets and registers the slug", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "dn-cloud-ws-" });
  const runnerHome = await Deno.makeTempDir({ prefix: "dn-cloud-home-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", runnerHome);
  const commands: string[][] = [];
  try {
    const dest = join(workspace, "chesapeakedev", "dn");
    await Deno.mkdir(join(dest, ".git"), { recursive: true });
    const path = await ensureCloudCheckout({
      repository: "chesapeakedev/dn",
      token: "ghs_test",
      env: { DN_RUNNER_WORKSPACE_ROOT: workspace },
      git: (args, cwd) => {
        commands.push([cwd, ...args]);
        return Promise.resolve({ success: true, output: "" });
      },
    });
    assertEquals(path, dest);
    assertEquals(commands[0]?.slice(1), ["fetch", "--depth", "1", "origin"]);
    assertEquals(commands[1]?.slice(1), ["reset", "--hard", "FETCH_HEAD"]);
    const config = await loadRunnerConfig(getRunnerConfigPaths(runnerHome));
    assertEquals(config.repositories["chesapeakedev/dn"]?.path, dest);
  } finally {
    if (previousHome == null) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(runnerHome, { recursive: true });
  }
});

Deno.test("ensureCloudCheckout clones when the destination is empty", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "dn-cloud-clone-" });
  const runnerHome = await Deno.makeTempDir({ prefix: "dn-cloud-home-" });
  const previousHome = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", runnerHome);
  try {
    const dest = join(workspace, "chesapeakedev", "denoise");
    const path = await ensureCloudCheckout({
      repository: "chesapeakedev/denoise",
      token: "ghs_test",
      env: { DN_RUNNER_WORKSPACE_ROOT: workspace },
      git: async (args) => {
        assertEquals(args[0], "clone");
        assertEquals(args[1], "--depth");
        assertStringIncludes(args[3] ?? "", "chesapeakedev/denoise.git");
        assertEquals(args[4], dest);
        await Deno.mkdir(dest, { recursive: true });
        return { success: true, output: "" };
      },
    });
    assertEquals(path, dest);
  } finally {
    if (previousHome == null) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previousHome);
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(runnerHome, { recursive: true });
  }
});
