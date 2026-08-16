// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { resolve } from "@std/path";
import {
  extractContextFiles,
  mergeContextFiles,
  resolveContextFileArgs,
} from "./contextFiles.ts";

Deno.test("extractContextFiles pulls repeatable flags from any position", () => {
  const { contextFiles, rest } = extractContextFiles([
    "--context-file",
    "notes.md",
    "kickstart",
    "--context-file",
    "src/parser.ts",
    "123",
  ]);

  assertEquals(contextFiles, [resolve("notes.md"), resolve("src/parser.ts")]);
  assertEquals(rest, ["kickstart", "123"]);
});

Deno.test("extractContextFiles rejects a missing path", () => {
  assertThrows(
    () => extractContextFiles(["--context-file"]),
    Error,
    "--context-file requires a path.",
  );
  assertThrows(
    () => extractContextFiles(["kickstart", "--context-file", "--awp"]),
    Error,
    "--context-file requires a path.",
  );
});

Deno.test("mergeContextFiles deduplicates resolved paths and keeps order", () => {
  const first = resolve("notes.md");
  const merged = mergeContextFiles(
    ["notes.md", "src/a.ts"],
    [first, "src/b.ts"],
  );
  assertEquals(merged, [
    resolve("notes.md"),
    resolve("src/a.ts"),
    resolve("src/b.ts"),
  ]);
});

Deno.test("resolveContextFileArgs merges global paths with local flags", () => {
  const { contextFiles, rest } = resolveContextFileArgs(
    ["--context-file", "local.md", "123"],
    ["global.md"],
  );
  assertEquals(contextFiles, [resolve("global.md"), resolve("local.md")]);
  assertEquals(rest, ["123"]);
});
