// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { ExeDevRunner } from "./exeDevRunner.ts";
import type { ExeDevHttpClient, SandboxContext } from "./types.ts";

const baseCtx = (): SandboxContext => ({
  repoRoot: "/repo",
  dryRun: false,
  config: {
    provider: "exe.dev",
    workspace: "/workspace",
    sync: { mode: "git_clone", exclude: [] },
    docker: {
      image: "denoland/deno",
      network: "none",
      read_only_root: true,
      mounts: [],
      env_pass_through: [],
    },
    exe_dev: {
      image: "exeuntu",
      vm_name_prefix: "dn-kickstart",
      ttl: "4h",
      integrations: ["github"],
    },
  },
});

Deno.test({
  name: "ExeDevRunner.provision posts new VM command",
  permissions: { env: true },
}, async () => {
  const calls: string[] = [];
  const http: ExeDevHttpClient = {
    exec(_token, command) {
      calls.push(command);
      return Promise.resolve({ status: 200, body: '{"ok":true}' });
    },
  };
  Deno.env.set("EXE_TOKEN", "exe1.test");
  try {
    const runner = new ExeDevRunner(http);
    const handle = await runner.provision(baseCtx());
    assertStringIncludes(calls[0], "new dn-kickstart-");
    assertStringIncludes(calls[0], "--image exeuntu");
    assertEquals(handle.provider, "exe.dev");
  } finally {
    Deno.env.delete("EXE_TOKEN");
  }
});

Deno.test("ExeDevRunner.provision dry-run skips HTTP", async () => {
  const http: ExeDevHttpClient = {
    exec() {
      throw new Error("should not call HTTP in dry-run");
    },
  };
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(String(args[0]));
  try {
    const runner = new ExeDevRunner(http);
    const handle = await runner.provision({ ...baseCtx(), dryRun: true });
    assertEquals(handle.dryRun, true);
    assertStringIncludes(logs.join("\n"), "Would POST");
  } finally {
    console.log = original;
  }
});

Deno.test({
  name: "ExeDevRunner.teardown posts rm command",
  permissions: { env: true },
}, async () => {
  const calls: string[] = [];
  const http: ExeDevHttpClient = {
    exec(_token, command) {
      calls.push(command);
      return Promise.resolve({ status: 200, body: "" });
    },
  };
  Deno.env.set("EXE_TOKEN", "exe1.test");
  try {
    const runner = new ExeDevRunner(http);
    await runner.teardown({
      provider: "exe.dev",
      id: "dn-kickstart-deadbeef",
      workspace: "/workspace",
    });
    assertEquals(calls[0], "rm dn-kickstart-deadbeef --json");
  } finally {
    Deno.env.delete("EXE_TOKEN");
  }
});
