// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildDockerRunArgs, DockerRunner } from "./dockerRunner.ts";
import type { CommandRunner, ExecResult, SandboxContext } from "./types.ts";

function mockRunner(responses: Record<string, ExecResult>): CommandRunner {
  return {
    run(argv) {
      const key = argv.join(" ");
      const result = responses[key];
      if (!result) {
        throw new Error(`Unexpected command: ${key}`);
      }
      return Promise.resolve(result);
    },
  };
}

Deno.test({
  name: "buildDockerRunArgs includes mounts, network, and env pass-through",
  permissions: { env: true },
}, () => {
  const prev = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  try {
    const ctx: SandboxContext = {
      repoRoot: "/tmp/repo",
      dryRun: false,
      config: {
        provider: "docker",
        workspace: "/workspace",
        sync: { mode: "bind", exclude: [] },
        docker: {
          image: "denoland/deno",
          network: "none",
          read_only_root: true,
          mounts: [{ source: ".", target: "/workspace" }],
          env_pass_through: ["OPENAI_API_KEY"],
        },
        exe_dev: {
          image: "exeuntu",
          vm_name_prefix: "dn-kickstart",
          ttl: "4h",
          integrations: [],
        },
      },
    };
    const args = buildDockerRunArgs(ctx);
    assertStringIncludes(args.join(" "), "-v /tmp/repo:/workspace");
    assertStringIncludes(args.join(" "), "--read-only");
    assertStringIncludes(args.join(" "), "-e OPENAI_API_KEY=test-key");
    assertEquals(args.at(-3), "denoland/deno");
  } finally {
    if (prev === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", prev);
  }
});

Deno.test("DockerRunner.provision returns container id from docker run", async () => {
  const runner = new DockerRunner(
    mockRunner({
      "docker run --rm -d --network none -w /workspace --read-only -v /repo:/workspace denoland/deno sleep infinity":
        { code: 0, stdout: "abc123\n", stderr: "" },
    }),
  );
  const handle = await runner.provision({
    repoRoot: "/repo",
    dryRun: false,
    config: {
      provider: "docker",
      workspace: "/workspace",
      sync: { mode: "bind", exclude: [] },
      docker: {
        image: "denoland/deno",
        network: "none",
        read_only_root: true,
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
  });
  assertEquals(handle.id, "abc123");
});

Deno.test("DockerRunner.provision dry-run logs planned command", async () => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(String(args[0]));
  try {
    const runner = new DockerRunner(mockRunner({}));
    const handle = await runner.provision({
      repoRoot: "/repo",
      dryRun: true,
      config: {
        provider: "docker",
        workspace: "/workspace",
        sync: { mode: "bind", exclude: [] },
        docker: {
          image: "denoland/deno",
          network: "none",
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
    });
    assertEquals(handle.dryRun, true);
    assertStringIncludes(logs.join("\n"), "Would run: docker run");
  } finally {
    console.log = original;
  }
});

Deno.test("DockerRunner.exec translates host cwd to sandbox workspace", async () => {
  let capturedArgv: string[] = [];
  const runner = new DockerRunner({
    run(argv) {
      if (argv[0] === "docker" && argv[1] === "run") {
        return Promise.resolve({ code: 0, stdout: "abc123\n", stderr: "" });
      }
      capturedArgv = argv;
      return Promise.resolve({ code: 0, stdout: "hello\n", stderr: "" });
    },
  });

  const handle = await runner.provision({
    repoRoot: "/Users/me/repo",
    dryRun: false,
    config: {
      provider: "docker",
      workspace: "/workspace",
      sync: { mode: "bind", exclude: [] },
      docker: {
        image: "denoland/deno",
        network: "none",
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
  });

  await runner.exec(
    handle,
    ["echo", "hello"],
    { cwd: "/Users/me/repo/.dn/tmp" },
  );

  assertStringIncludes(capturedArgv.join(" "), "-w /workspace/.dn/tmp");
});
