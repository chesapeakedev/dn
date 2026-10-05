// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { buildRunnerLogsCommand } from "./runner.ts";
import { runDnCommand } from "./test_utils.ts";

Deno.test("runner CLI exposes the device command surface", async () => {
  const result = await runDnCommand(["runner", "--help"]);
  assertStringIncludes(result.stdout, "dn runner connect");
  assertStringIncludes(result.stdout, "dn runner status");
  assertStringIncludes(result.stdout, "dn runner install");
  assertStringIncludes(result.stdout, "dn runner start");
  assertStringIncludes(result.stdout, "dn runner stop");
  assertStringIncludes(result.stdout, "dn runner logs [--follow]");
  assertStringIncludes(result.stdout, "dn runner serve");
});

Deno.test("runner logs uses the macOS LaunchAgent log files", () => {
  assertEquals(
    buildRunnerLogsCommand("darwin", "/Users/tester", true),
    {
      command: "tail",
      args: [
        "-n",
        "200",
        "-f",
        "/Users/tester/.dn/runner/runner.log",
        "/Users/tester/.dn/runner/runner.error.log",
      ],
    },
  );
});

Deno.test("runner logs uses the Linux user journal", () => {
  assertEquals(
    buildRunnerLogsCommand("linux", "/home/tester", true),
    {
      command: "journalctl",
      args: [
        "--user",
        "-u",
        "denoise-runner.service",
        "-n",
        "200",
        "--no-pager",
        "-f",
      ],
    },
  );
});

Deno.test("runner logs rejects unsupported platforms", () => {
  assertThrows(
    () => buildRunnerLogsCommand("windows", "C:\\Users\\tester", true),
    Error,
    "require macOS or Linux",
  );
});

Deno.test("runner CLI does not expose issue dispatch", async () => {
  const result = await runDnCommand(["runner", "kickstart"], {
    expectFailure: true,
  });
  assertStringIncludes(result.stderr, "Unknown runner subcommand: kickstart");
});
