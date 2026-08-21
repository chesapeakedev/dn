// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  generateLaunchdService,
  generateSystemdService,
  inspectRunnerService,
  LAUNCHCTL_EINPROGRESS,
  launchdServiceTarget,
  parseLaunchctlPrint,
  parseLaunchdProgramArguments,
  parseSystemdExecStart,
  parseSystemdShow,
  refreshRunnerServiceIfPresent,
  replaceLaunchdService,
  type RunnerServiceCommandProbe,
  type RunnerServiceCommandResult,
  runnerServiceCommandsEqual,
} from "./service.ts";

Deno.test("generateLaunchdService creates a user agent with escaped argv", () => {
  const service = generateLaunchdService(
    ["/Users/alex/My Tools/dn", "runner", "serve", "a&b"],
    "/Users/alex",
  );
  assertEquals(
    service.path,
    "/Users/alex/Library/LaunchAgents/cloud.denoise.runner.plist",
  );
  assertStringIncludes(service.content, "<string>runner</string>");
  assertStringIncludes(service.content, "<key>DN_RUNNER_SERVICE</key>");
  assertStringIncludes(service.content, "<string>a&amp;b</string>");
  assertStringIncludes(service.content, "<key>SuccessfulExit</key>");
  assertStringIncludes(service.content, "<key>ThrottleInterval</key>");
  assertStringIncludes(service.content, "<key>HOME</key>");
  assertStringIncludes(service.content, "<string>/Users/alex</string>");
  assertStringIncludes(service.content, "<key>PATH</key>");
});

Deno.test("generateSystemdService creates a non-root user service", () => {
  const service = generateSystemdService(
    ["/home/alex/bin/dn", "runner", "serve"],
    "/home/alex",
  );
  assertEquals(
    service.path,
    "/home/alex/.config/systemd/user/denoise-runner.service",
  );
  assertStringIncludes(
    service.content,
    'ExecStart="/home/alex/bin/dn" "runner" "serve"',
  );
  assertStringIncludes(service.content, 'Environment="DN_RUNNER_SERVICE=1"');
  assertStringIncludes(service.content, "NoNewPrivileges=true");
  assertStringIncludes(service.content, 'Environment="HOME=/home/alex"');
  assertStringIncludes(service.content, 'Environment="PATH=');
  assertStringIncludes(service.content, "Restart=on-failure");
});

Deno.test("launchdServiceTarget is the bootout service-target", () => {
  assertEquals(launchdServiceTarget(501), "gui/501/cloud.denoise.runner");
});

Deno.test("parseLaunchctlPrint reads running state and pid", () => {
  assertEquals(
    parseLaunchctlPrint(`
gui/501/cloud.denoise.runner = {
	last running state = running
	state = running
	pid = 12345
}
`),
    { running: true, pid: 12345 },
  );
  assertEquals(
    parseLaunchctlPrint("\tstate = not running\n"),
    { running: false },
  );
});

Deno.test("parseSystemdShow reads active state and MainPID", () => {
  assertEquals(
    parseSystemdShow("ActiveState=active\nMainPID=99\n"),
    { running: true, pid: 99 },
  );
  assertEquals(
    parseSystemdShow("ActiveState=inactive\nMainPID=0\n"),
    { running: false },
  );
});

Deno.test("inspectRunnerService reports a missing launchd unit as not running", async () => {
  const definition = generateLaunchdService(
    ["/usr/local/bin/dn", "runner", "serve"],
    "/Users/alex",
  );
  const probe: RunnerServiceCommandProbe = {
    run() {
      return Promise.resolve({
        success: false,
        stdout: "",
        stderr: "Could not find service",
      });
    },
    exists() {
      return Promise.resolve(false);
    },
    readText() {
      return Promise.reject(new Deno.errors.NotFound("missing"));
    },
  };
  assertEquals(
    await inspectRunnerService(definition, { probe, uid: 501 }),
    {
      installed: false,
      running: false,
      supervisor: "launchd",
      path: definition.path,
    },
  );
});

Deno.test("inspectRunnerService reports a running launchd agent", async () => {
  const definition = generateLaunchdService(
    ["/usr/local/bin/dn", "runner", "serve"],
    "/Users/alex",
  );
  const probe: RunnerServiceCommandProbe = {
    run(command, args) {
      assertEquals(command, "launchctl");
      assertEquals(args, ["print", "gui/501/cloud.denoise.runner"]);
      return Promise.resolve({
        success: true,
        stdout: "\tstate = running\n\tpid = 4242\n",
        stderr: "",
      });
    },
    exists(path) {
      assertEquals(path, definition.path);
      return Promise.resolve(true);
    },
    readText() {
      return Promise.resolve(definition.content);
    },
  };
  assertEquals(
    await inspectRunnerService(definition, { probe, uid: 501 }),
    {
      installed: true,
      running: true,
      supervisor: "launchd",
      path: definition.path,
      pid: 4242,
      command: ["/usr/local/bin/dn", "runner", "serve"],
    },
  );
});

Deno.test("inspectRunnerService reports an installed but stopped systemd unit", async () => {
  const definition = generateSystemdService(
    ["/home/alex/bin/dn", "runner", "serve"],
    "/home/alex",
  );
  const probe: RunnerServiceCommandProbe = {
    run(command, args) {
      assertEquals(command, "systemctl");
      assertEquals(args[0], "--user");
      assertEquals(args[1], "show");
      return Promise.resolve({
        success: true,
        stdout: "ActiveState=inactive\nMainPID=0\n",
        stderr: "",
      });
    },
    exists() {
      return Promise.resolve(true);
    },
    readText() {
      return Promise.resolve(definition.content);
    },
  };
  assertEquals(
    await inspectRunnerService(definition, { probe }),
    {
      installed: true,
      running: false,
      supervisor: "systemd",
      path: definition.path,
      command: ["/home/alex/bin/dn", "runner", "serve"],
    },
  );
});

Deno.test("parseLaunchdProgramArguments and systemd ExecStart round-trip generated units", () => {
  const launchd = generateLaunchdService(
    ["/Users/alex/My Tools/dn", "runner", "serve", "a&b"],
    "/Users/alex",
  );
  const systemd = generateSystemdService(
    ["/home/alex/bin/dn", "runner", "serve"],
    "/home/alex",
  );
  assertEquals(
    parseLaunchdProgramArguments(launchd.content),
    ["/Users/alex/My Tools/dn", "runner", "serve", "a&b"],
  );
  assertEquals(
    parseSystemdExecStart(systemd.content),
    ["/home/alex/bin/dn", "runner", "serve"],
  );
  assertEquals(
    runnerServiceCommandsEqual(
      ["/usr/local/bin/dn", "runner", "serve"],
      ["/usr/local/bin/dn", "runner", "serve"],
    ),
    true,
  );
  assertEquals(
    runnerServiceCommandsEqual(
      ["/usr/local/bin/dn", "runner", "serve"],
      ["/opt/dn", "runner", "serve"],
    ),
    false,
  );
});

function launchdPrintResult(pid: number): RunnerServiceCommandResult {
  return {
    success: true,
    stdout: `\tstate = running\n\tpid = ${pid}\n`,
    stderr: "",
    code: 0,
  };
}

function launchctlOk(): RunnerServiceCommandResult {
  return { success: true, stdout: "", stderr: "", code: 0 };
}

function recordingLaunchdProbe(options: {
  definition: ReturnType<typeof generateLaunchdService>;
  prints: number[];
  bootoutCodes?: number[];
}): { probe: RunnerServiceCommandProbe; calls: string[][] } {
  const calls: string[][] = [];
  let printIndex = 0;
  let bootoutIndex = 0;
  const bootoutCodes = options.bootoutCodes ?? [0];
  const probe: RunnerServiceCommandProbe = {
    run(command, args) {
      assertEquals(command, "launchctl");
      calls.push([...args]);
      const [verb] = args;
      if (verb === "print") {
        const pid = options.prints[
          Math.min(printIndex, options.prints.length - 1)
        ];
        printIndex += 1;
        return Promise.resolve(launchdPrintResult(pid));
      }
      if (verb === "bootout") {
        const code = bootoutCodes[
          Math.min(bootoutIndex, bootoutCodes.length - 1)
        ];
        bootoutIndex += 1;
        return Promise.resolve({
          success: code === 0,
          stdout: "",
          stderr: code === LAUNCHCTL_EINPROGRESS ? "in progress" : "",
          code,
        });
      }
      if (verb === "enable" || verb === "bootstrap" || verb === "kickstart") {
        return Promise.resolve(launchctlOk());
      }
      throw new Error(`unexpected launchctl ${args.join(" ")}`);
    },
    exists() {
      return Promise.resolve(true);
    },
    readText() {
      return Promise.resolve(options.definition.content);
    },
    processExists() {
      return Promise.resolve(false);
    },
    killProcess() {
      return Promise.resolve();
    },
  };
  return { probe, calls };
}

Deno.test("refreshRunnerServiceIfPresent no-ops when the unit file is missing", async () => {
  const definition = generateLaunchdService(
    ["/usr/local/bin/dn", "runner", "serve"],
    "/Users/alex",
  );
  let ran = false;
  const probe: RunnerServiceCommandProbe = {
    run() {
      ran = true;
      return Promise.resolve(launchctlOk());
    },
    exists() {
      return Promise.resolve(false);
    },
    readText() {
      return Promise.reject(new Deno.errors.NotFound("missing"));
    },
  };
  assertEquals(
    await refreshRunnerServiceIfPresent(definition, {
      probe,
      uid: 501,
      sleep: () => Promise.resolve(),
    }),
    { refreshed: false },
  );
  assertEquals(ran, false);
});

Deno.test("replaceLaunchdService retries EINPROGRESS bootout then enable and bootstrap", async () => {
  const definition = generateLaunchdService(
    ["/usr/local/bin/dn", "runner", "serve"],
    "/Users/alex",
  );
  const { probe, calls } = recordingLaunchdProbe({
    definition,
    prints: [111, 222],
    bootoutCodes: [
      LAUNCHCTL_EINPROGRESS,
      LAUNCHCTL_EINPROGRESS,
      0,
    ],
  });
  await replaceLaunchdService(definition, {
    probe,
    uid: 501,
    sleep: () => Promise.resolve(),
  });
  assertEquals(calls.filter((args) => args[0] === "bootout").length, 3);
  const verbs = calls.map((args) => args[0]);
  const enableAt = verbs.indexOf("enable");
  const bootstrapAt = verbs.indexOf("bootstrap");
  assertEquals(enableAt >= 0 && bootstrapAt > enableAt, true);
  assertEquals(calls[enableAt], ["enable", "gui/501/cloud.denoise.runner"]);
  assertEquals(calls[bootstrapAt], [
    "bootstrap",
    "gui/501",
    definition.path,
  ]);
  assertEquals(verbs.includes("kickstart"), false);
});

Deno.test("replaceLaunchdService kickstarts when the PID does not change after bootstrap", async () => {
  const definition = generateLaunchdService(
    ["/usr/local/bin/dn", "runner", "serve"],
    "/Users/alex",
  );
  const { probe, calls } = recordingLaunchdProbe({
    definition,
    prints: [111, 111, 222],
  });
  await replaceLaunchdService(definition, {
    probe,
    uid: 501,
    sleep: () => Promise.resolve(),
  });
  assertEquals(
    calls.some((args) =>
      args[0] === "kickstart" && args[1] === "-k" &&
      args[2] === "gui/501/cloud.denoise.runner"
    ),
    true,
  );
});
