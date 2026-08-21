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
  parsePsElapsedMs,
  repositorySlugFromRemote,
  type RunnerCommandProbe,
  type RunnerRemoteProbeResult,
  serveLogShowsActiveJob,
  serveLoopHungReason,
} from "./doctor.ts";
import type { RunnerServiceStatus } from "./service.ts";

Deno.test("parsePsElapsedMs accepts etimes seconds and etime clocks", () => {
  assertEquals(parsePsElapsedMs("  42\n"), 42_000);
  assertEquals(parsePsElapsedMs("03:04"), 184_000);
  assertEquals(parsePsElapsedMs("01:02:03"), 3_723_000);
  assertEquals(parsePsElapsedMs("1-02:03:04"), 93_784_000);
});

Deno.test("serveLogShowsActiveJob ignores completed jobs and idle lines", () => {
  assertEquals(
    serveLogShowsActiveJob(
      "[2026-08-19T22:36:11.104Z] Starting job 9803710f in /tmp: dn kickstart",
    ),
    true,
  );
  assertEquals(
    serveLogShowsActiveJob(
      "[2026-08-19T22:36:12.561Z] Job 9803710f failed (1s): dn kickstart exited with code 137.",
    ),
    false,
  );
  assertEquals(
    serveLogShowsActiveJob(
      "[2026-08-20T01:53:26.385Z] Still waiting for jobs",
    ),
    false,
  );
});

Deno.test("serveLoopHungReason detects a running PID with a stale alive stamp", () => {
  const nowMs = Date.parse("2026-08-20T22:00:00.000Z");
  assertEquals(
    serveLoopHungReason({
      nowMs,
      supervisor: "launchd",
      pid: 66056,
      aliveAtMs: Date.parse("2026-08-19T22:00:00.000Z"),
      processAgeMs: 86_400_000,
    })?.includes("hung"),
    true,
  );
  assertEquals(
    serveLoopHungReason({
      nowMs,
      supervisor: "launchd",
      pid: 66056,
      aliveAtMs: nowMs - 30_000,
      processAgeMs: 86_400_000,
    }),
    null,
  );
});

Deno.test("serveLoopHungReason ignores leftover stamps while a new process is starting", () => {
  const nowMs = Date.parse("2026-08-20T22:00:00.000Z");
  assertEquals(
    serveLoopHungReason({
      nowMs,
      supervisor: "launchd",
      pid: 66056,
      aliveAtMs: Date.parse("2026-08-19T22:00:00.000Z"),
      processAgeMs: 5_000,
    }),
    null,
  );
});

Deno.test("serveLoopHungReason does not treat a quiet in-progress job log as hung", () => {
  const nowMs = Date.parse("2026-08-20T22:00:00.000Z");
  assertEquals(
    serveLoopHungReason({
      nowMs,
      supervisor: "launchd",
      pid: 66056,
      lastLogAtMs: nowMs - 30 * 60_000,
      lastLogLine:
        "[2026-08-20T21:30:00.000Z] Starting job abc in /tmp: dn kickstart",
      processAgeMs: 86_400_000,
    }),
    null,
  );
});

Deno.test("serveLoopHungReason treats a stale idle runner.log as hung on older builds", () => {
  const nowMs = Date.parse("2026-08-20T22:00:00.000Z");
  assertEquals(
    serveLoopHungReason({
      nowMs,
      supervisor: "launchd",
      pid: 66056,
      lastLogAtMs: Date.parse("2026-08-19T22:00:00.000Z"),
      lastLogLine: "[2026-08-19T22:00:00.000Z] Still waiting for jobs",
      processAgeMs: 86_400_000,
    })?.includes("hung"),
    true,
  );
});

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
    owner_id: "owner-1",
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

function checkinCheck(
  result: { checks: { name: string; ok: boolean; message: string }[] },
) {
  return result.checks.find((check) => check.name === "checkin");
}

function pairingCheck(
  result: { checks: { name: string; ok: boolean; message: string }[] },
) {
  return result.checks.find((check) => check.name === "pairing");
}

function recentRemote(
  extras: Partial<Extract<RunnerRemoteProbeResult, { kind: "ok" }>> = {},
): () => Promise<RunnerRemoteProbeResult> {
  return () =>
    Promise.resolve({
      kind: "ok",
      last_seen_at: extras.last_seen_at ?? new Date().toISOString(),
      state: extras.state ?? "ready",
    });
}

const runningService = {
  installed: true,
  running: true,
  supervisor: "launchd" as const,
  path: "/Users/alex/Library/LaunchAgents/cloud.denoise.runner.plist",
  pid: 4242,
  command: ["/usr/local/bin/dn", "runner", "serve"],
};

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
        probeRemote: recentRemote(),
      });
      assertEquals(serviceCheck(result)?.ok, false);
      assertEquals(checkinCheck(result), undefined);
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
        probeRemote: recentRemote(),
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
        inspectService: () => Promise.resolve(runningService),
        expectedServiceCommand: ["/opt/other/dn", "runner", "serve"],
        probeRemote: recentRemote(),
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
      assertEquals(checkinCheck(result)?.ok, true);
    });
  },
});

Deno.test({
  name:
    "doctorRunner fails the service check when the LaunchAgent process is hung",
  ignore: Deno.build.os !== "darwin" && Deno.build.os !== "linux",
  async fn() {
    await withRunnerHome(async (directory) => {
      await saveTestCredential(directory);
      const result = await doctorRunner(harnessProbe, {
        inspectService: () => Promise.resolve(runningService),
        inspectServeLoop: () =>
          Promise.resolve({
            aliveAtMs: Date.parse("2026-08-19T22:00:00.000Z"),
            processAgeMs: 86_400_000,
          }),
        probeRemote: recentRemote(),
        nowMs: Date.parse("2026-08-20T22:00:00.000Z"),
      });
      assertEquals(serviceCheck(result)?.ok, false);
      assertEquals(serviceCheck(result)?.message.includes("hung"), true);
      assertEquals(result.ok, false);
    });
  },
});

Deno.test({
  name:
    "doctorRunner fails checkin when Denoise last heard from a running loop hours ago",
  ignore: Deno.build.os !== "darwin" && Deno.build.os !== "linux",
  async fn() {
    await withRunnerHome(async (directory) => {
      await saveTestCredential(directory);
      const result = await doctorRunner(harnessProbe, {
        inspectService: () => Promise.resolve(runningService),
        probeRemote: recentRemote({
          last_seen_at: "2026-08-19T22:00:00.000Z",
          state: "offline",
        }),
        nowMs: Date.parse("2026-08-20T22:00:00.000Z"),
      });
      assertEquals(serviceCheck(result)?.ok, true);
      assertEquals(checkinCheck(result)?.ok, false);
      assertEquals(
        checkinCheck(result)?.message.includes("dn runner install"),
        true,
      );
      assertEquals(result.ok, false);
    });
  },
});

Deno.test({
  name: "doctorRunner fails pairing when Denoise rejects the credential",
  ignore: Deno.build.os !== "darwin" && Deno.build.os !== "linux",
  async fn() {
    await withRunnerHome(async (directory) => {
      await saveTestCredential(directory);
      const result = await doctorRunner(harnessProbe, {
        inspectService: () => Promise.resolve(runningService),
        probeRemote: () =>
          Promise.resolve({
            kind: "rejected",
            error: "Invalid or expired runner credential",
          }),
      });
      assertEquals(pairingCheck(result)?.ok, false);
      assertEquals(
        pairingCheck(result)?.message.includes("pair again"),
        true,
      );
      assertEquals(checkinCheck(result), undefined);
      assertEquals(result.ok, false);
    });
  },
});
