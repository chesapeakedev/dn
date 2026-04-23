// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  bumpPatchVersion,
  findPreviousReleaseCommit,
  formatCommitMessage,
  formatReleaseNotes,
  parseSaplingLog,
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
