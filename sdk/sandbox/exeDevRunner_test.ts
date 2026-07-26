// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { ExeDevRunner } from "./exeDevRunner.ts";
import type {
  CommandRunner,
  ExeDevHttpClient,
  SandboxContext,
} from "./types.ts";

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

Deno.test({
  name: "ExeDevRunner.syncIn honors sync.exclude and repo root",
  permissions: { env: true, read: true, write: true },
}, async () => {
  const commands: Array<{ argv: string[]; cwd?: string }> = [];
  const commandRunner: CommandRunner = {
    run(argv, options) {
      commands.push({ argv, cwd: options?.cwd });
      if (argv.join(" ") === "git rev-parse --abbrev-ref HEAD") {
        return Promise.resolve({ code: 0, stdout: "feature\n", stderr: "" });
      }
      if (argv.join(" ") === "git remote get-url origin") {
        return Promise.resolve({
          code: 0,
          stdout: "git@github.com:owner/repo.git\n",
          stderr: "",
        });
      }
      if (argv.join(" ") === "git rev-parse HEAD") {
        return Promise.resolve({ code: 0, stdout: "base-sha\n", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
  };
  const httpCalls: string[] = [];
  const http: ExeDevHttpClient = {
    exec(_token, command) {
      httpCalls.push(command);
      return Promise.resolve({ status: 200, body: "" });
    },
  };

  Deno.env.set("EXE_TOKEN", "exe1.test");
  try {
    const runner = new ExeDevRunner(http, commandRunner);
    const handle = await runner.provision({
      ...baseCtx(),
      repoRoot: "/repo",
      config: {
        ...baseCtx().config,
        sync: { mode: "git_clone", exclude: ["node_modules", ".dn/tmp"] },
      },
    });

    await runner.syncIn(handle);

    assertEquals(commands[0], {
      argv: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      cwd: "/repo",
    });
    assertEquals(commands[1], {
      argv: [
        "git",
        "add",
        "-A",
        "--",
        ".",
        ":(exclude)node_modules",
        ":(exclude).dn/tmp",
      ],
      cwd: "/repo",
    });
    assertEquals(commands[3].argv, [
      "git",
      "push",
      "--force-with-lease",
      "-u",
      "origin",
      "HEAD:feature",
    ]);
    assertStringIncludes(httpCalls.at(-1) ?? "", "git clone");
    assertStringIncludes(httpCalls.at(-1) ?? "", "--branch 'feature'");
  } finally {
    Deno.env.delete("EXE_TOKEN");
  }
});

Deno.test({
  name: "ExeDevRunner.syncOut honors sync.exclude in remote git add",
  permissions: { env: true, read: true, write: true },
}, async () => {
  const commandRunner: CommandRunner = {
    run(argv) {
      if (argv.join(" ") === "git rev-parse --abbrev-ref HEAD") {
        return Promise.resolve({ code: 0, stdout: "feature\n", stderr: "" });
      }
      if (argv.join(" ") === "git remote get-url origin") {
        return Promise.resolve({
          code: 0,
          stdout: "git@github.com:owner/repo.git\n",
          stderr: "",
        });
      }
      if (argv.join(" ") === "git rev-parse HEAD") {
        return Promise.resolve({ code: 0, stdout: "base-sha\n", stderr: "" });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
  };
  const httpCalls: string[] = [];
  const http: ExeDevHttpClient = {
    exec(_token, command) {
      httpCalls.push(command);
      return Promise.resolve({ status: 200, body: "" });
    },
  };

  Deno.env.set("EXE_TOKEN", "exe1.test");
  try {
    const runner = new ExeDevRunner(http, commandRunner);
    const handle = await runner.provision({
      ...baseCtx(),
      config: {
        ...baseCtx().config,
        sync: { mode: "git_clone", exclude: ["node_modules", "it's-temp"] },
      },
    });
    await runner.syncIn(handle);
    await runner.syncOut(handle);

    const syncOutCommand = httpCalls.find((command) =>
      command.includes("synchronize sandbox output")
    ) ?? "";
    assertStringIncludes(syncOutCommand, "git add -A -- .");
    assertStringIncludes(syncOutCommand, "':(exclude)node_modules'");
    assertStringIncludes(syncOutCommand, `':(exclude)it'"'"'s-temp'`);
    assertStringIncludes(syncOutCommand, "git push origin HEAD:'feature'");
  } finally {
    Deno.env.delete("EXE_TOKEN");
  }
});
