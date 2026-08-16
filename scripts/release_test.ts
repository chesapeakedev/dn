// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  bumpPatchVersion,
  findPreviousReleaseCommit,
  formatCommitMessage,
  formatJsrPublishDryRunError,
  formatReleaseNotes,
  JSR_PUBLISH_DRY_RUN_ARGS,
  parseSaplingLog,
  repositoryFromRemoteUrl,
  validateReleaseVersion,
  validateSemanticVersion,
} from "./release.ts";

Deno.test("parseSaplingLog ignores watchman noise", () => {
  const commits = parseSaplingLog(
    [
      "watchman sockpath is set as /tmp/watchman/sock",
      "e9fd29466ceb\tRefactor agent selection into top level --agent",
      "8010f3fedfb2\tfix idempotency for dn init agents",
      "",
    ].join("\n"),
  );

  assertEquals(commits, [
    {
      node: "e9fd29466ceb",
      subject: "Refactor agent selection into top level --agent",
    },
    {
      node: "8010f3fedfb2",
      subject: "fix idempotency for dn init agents",
    },
  ]);
});

Deno.test("findPreviousReleaseCommit matches current version prefix", () => {
  const release = findPreviousReleaseCommit(
    [
      { node: "e9fd29466ceb", subject: "Refactor agent selection" },
      { node: "47f8cc7eaa86", subject: "0.0.20: more context commands" },
      { node: "d13a511e2bd2", subject: "add dn context check command" },
    ],
    "0.0.20",
  );

  assertEquals(release, {
    node: "47f8cc7eaa86",
    subject: "0.0.20: more context commands",
  });
});

Deno.test("bumpPatchVersion increments patch version", () => {
  assertEquals(bumpPatchVersion("0.0.20"), "0.0.21");
  assertEquals(bumpPatchVersion("1.2.9"), "1.2.10");
});

Deno.test("bumpPatchVersion rejects invalid semantic versions", () => {
  assertThrows(() => bumpPatchVersion("0.0"));
  assertThrows(() => bumpPatchVersion("0.0.x"));
  assertThrows(() => bumpPatchVersion("0.0.-1"));
});

Deno.test("validateReleaseVersion accepts a newer explicit version", () => {
  assertEquals(validateReleaseVersion("0.0.30", "0.31.0"), "0.31.0");
  assertEquals(validateReleaseVersion("1.2.3", "2.0.0"), "2.0.0");
});

Deno.test("validateReleaseVersion rejects invalid or older versions", () => {
  assertThrows(() => validateReleaseVersion("0.0.30", "0.0.30"));
  assertThrows(() => validateReleaseVersion("0.0.30", "0.0.29"));
  assertThrows(() => validateReleaseVersion("0.0.30", "0.01.0"));
});

Deno.test("validateSemanticVersion accepts semantic versions", () => {
  assertEquals(validateSemanticVersion("0.31.0"), "0.31.0");
  assertEquals(validateSemanticVersion("0.0.31"), "0.0.31");
});

Deno.test("validateSemanticVersion rejects invalid semantic versions", () => {
  assertThrows(() => validateSemanticVersion("0.31"));
  assertThrows(() => validateSemanticVersion("0.01.0"));
  assertThrows(() => validateSemanticVersion("v0.31.0"));
});

Deno.test("formatReleaseNotes includes commit subjects", () => {
  const notes = formatReleaseNotes("0.0.20", [
    {
      node: "0f532d6bda52",
      subject: "add support for github issue relationships",
    },
    { node: "fb4a1f6867ec", subject: "add dn init agents" },
  ]);

  assertEquals(
    notes,
    [
      "## Changes since 0.0.20",
      "",
      "- add support for github issue relationships",
      "- add dn init agents",
      "",
    ].join("\n"),
  );
});

Deno.test("formatCommitMessage uses new version subject and release notes body", () => {
  const message = formatCommitMessage("0.0.21", "0.0.20", [
    { node: "8010f3fedfb2", subject: "fix idempotency for dn init agents" },
  ]);

  assertEquals(
    message,
    [
      "0.0.21: release updates",
      "",
      "## Changes since 0.0.20",
      "",
      "- fix idempotency for dn init agents",
      "",
    ].join("\n"),
  );
});

Deno.test("repositoryFromRemoteUrl parses GitHub remotes", () => {
  assertEquals(
    repositoryFromRemoteUrl("https://github.com/chesapeakedev/dn.git"),
    "chesapeakedev/dn",
  );
  assertEquals(
    repositoryFromRemoteUrl("git@github.com:chesapeakedev/dn.git"),
    "chesapeakedev/dn",
  );
  assertEquals(
    repositoryFromRemoteUrl("https://example.com/chesapeakedev/dn.git"),
    undefined,
  );
});

Deno.test("JSR publish dry-run args do not upload", () => {
  assertEquals([...JSR_PUBLISH_DRY_RUN_ARGS], [
    "deno",
    "publish",
    "--dry-run",
  ]);
});

Deno.test("formatJsrPublishDryRunError tells operators to fix JSR before GitHub", () => {
  const message = formatJsrPublishDryRunError(
    "error[excluded-module]: module in package's module graph was excluded from publishing\n --> kickstart/includedPrompt.ts",
  );
  assertStringIncludes(message, "JSR publish dry-run failed");
  assertStringIncludes(message, "before creating a GitHub release");
  assertStringIncludes(
    message,
    "cannot recover a version that already shipped",
  );
  assertStringIncludes(message, "error[excluded-module]");
  assertStringIncludes(message, "kickstart/includedPrompt.ts");
});

Deno.test("formatJsrPublishDryRunError handles empty command output", () => {
  assertStringIncludes(formatJsrPublishDryRunError("  \n"), "(no output)");
});

Deno.test("deno publish --dry-run succeeds for the current package graph", async () => {
  const result = await new Deno.Command("deno", {
    args: ["publish", "--dry-run", "--allow-dirty"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.code !== 0) {
    throw new Error(
      formatJsrPublishDryRunError(
        [
          new TextDecoder().decode(result.stderr),
          new TextDecoder().decode(result.stdout),
        ].join("\n"),
      ),
    );
  }
});
