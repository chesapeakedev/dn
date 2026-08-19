// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  getRunnerConfigPaths,
  RUNNER_CONFIG_SCHEMA_VERSION,
  saveRunnerCredential,
} from "./config.ts";
import {
  doctorRunner,
  inspectRunnerRepository,
  repositorySlugFromRemote,
  type RunnerCommandProbe,
} from "./doctor.ts";
import type { RunnerServiceStatus } from "./service.ts";

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

const harnessProbe: RunnerCommandProbe = {
  run(command) {
    if (command === "codex") {
      return Promise.resolve({ success: true, stdout: "1", stderr: "" });
    }
    return Promise.resolve({ success: false, stdout: "", stderr: "" });
  },
};

async function withRunnerHome(
  fn: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-doctor-" });
  const previous = Deno.env.get("DN_RUNNER_HOME");
  Deno.env.set("DN_RUNNER_HOME", directory);
  try {
    await fn(directory);
  } finally {
    if (previous === undefined) Deno.env.delete("DN_RUNNER_HOME");
    else Deno.env.set("DN_RUNNER_HOME", previous);
    await Deno.remove(directory, { recursive: true });
  }
}

async function saveTestCredential(directory: string): Promise<void> {
  await saveRunnerCredential({
    schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
    runner_id: "runner-1",
    display_name: "Alex's MacBook",
    api_url: "https://denoise.example",
    credential: "runner-secret",
    created_at: "2026-07-23T12:00:00.000Z",
    expires_at: "2027-07-23T12:00:00.000Z",
  }, getRunnerConfigPaths(directory));
}

function serviceCheck(
  result: { checks: { name: string; ok: boolean; message: string }[] },
) {
  return result.checks.find((check) => check.name === "service");
}

Deno.test({
  name: "doctorRunner omits the service check before pairing",
  ignore: Deno.build.os !== "darwin" && Deno.build.os !== "linux",
  async fn() {
    await withRunnerHome(async () => {
      const result = await doctorRunner(harnessProbe, {
        inspectService: () =>
          Promise.resolve({
            installed: false,
            running: false,
            supervisor: "launchd",
            path: "/tmp/missing.plist",
          }),
      });
      assertEquals(serviceCheck(result), undefined);
    });
  },
});

Deno.test({
  name: "doctorRunner fails when paired but no serve loop is running",
  ignore: Deno.build.os !== "darwin" && Deno.build.os !== "linux",
  async fn() {
    await withRunnerHome(async (directory) => {
      await saveTestCredential(directory);
      const result = await doctorRunner(harnessProbe, {
        inspectService: () =>
          Promise.resolve({
            installed: false,
            running: false,
            supervisor: "launchd",
            path: "/tmp/missing.plist",
          }),
      });
      assertEquals(serviceCheck(result)?.ok, false);
      assertEquals(result.ok, false);
    });
  },
});

Deno.test({
  name: "doctorRunner fails when the user service is installed but stopped",
  ignore: Deno.build.os !== "darwin" && Deno.build.os !== "linux",
  async fn() {
    await withRunnerHome(async (directory) => {
      await saveTestCredential(directory);
      const result = await doctorRunner(harnessProbe, {
        inspectService: () =>
          Promise.resolve(
            {
              installed: true,
              running: false,
              supervisor: "launchd",
              path:
                "/Users/alex/Library/LaunchAgents/cloud.denoise.runner.plist",
            } satisfies RunnerServiceStatus,
          ),
      });
      assertEquals(serviceCheck(result)?.ok, false);
      assertEquals(
        serviceCheck(result)?.message.includes("dn runner start"),
        true,
      );
    });
  },
});

Deno.test({
  name: "doctorRunner passes the service check when the LaunchAgent is running",
  ignore: Deno.build.os !== "darwin" && Deno.build.os !== "linux",
  async fn() {
    await withRunnerHome(async (directory) => {
      await saveTestCredential(directory);
      const result = await doctorRunner(harnessProbe, {
        inspectService: () =>
          Promise.resolve({
            installed: true,
            running: true,
            supervisor: "launchd",
            path: "/Users/alex/Library/LaunchAgents/cloud.denoise.runner.plist",
            pid: 4242,
            command: ["/usr/local/bin/dn", "runner", "serve"],
          }),
        expectedServiceCommand: ["/opt/other/dn", "runner", "serve"],
      });
      assertEquals(serviceCheck(result)?.ok, true);
      assertEquals(
        serviceCheck(result)?.message.includes("pid 4242"),
        true,
      );
      assertEquals(
        serviceCheck(result)?.message.includes("dn runner install to refresh"),
        true,
      );
    });
  },
});
