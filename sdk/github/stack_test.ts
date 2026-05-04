// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  formatStackArtifactId,
  getStackArtifactPaths,
  parseStackTodoItems,
  sanitizeStackFilenamePart,
} from "./stack.ts";

Deno.test("formatStackArtifactId prefixes milestone with owner and repo", () => {
  assertEquals(
    formatStackArtifactId("chesapeakedev", "dn", 42),
    "chesapeakedev_dn_42",
  );
});

Deno.test("formatStackArtifactId preserves hyphenated GitHub names", () => {
  assertEquals(
    formatStackArtifactId("chesapeake-dev", "dn-tools", 7),
    "chesapeake-dev_dn-tools_7",
  );
});

Deno.test("sanitizeStackFilenamePart replaces unusual characters", () => {
  assertEquals(
    sanitizeStackFilenamePart("owner.name/example"),
    "owner.name_example",
  );
  assertThrows(() => sanitizeStackFilenamePart("///"));
});

Deno.test("getStackArtifactPaths returns markdown and JSON stack paths", () => {
  assertEquals(
    getStackArtifactPaths("/repo", "owner", "repo", 3),
    {
      id: "owner_repo_3",
      markdownPath: "/repo/plans/owner_repo_3.stack.md",
      jsonPath: "/repo/plans/owner_repo_3.stack.json",
    },
  );
});

Deno.test("parseStackTodoItems accepts issue numbers and full issue URLs", () => {
  const items = parseStackTodoItems(`
# Milestone

- [ ] 1 #45 Add login button
- [x] 3 https://github.com/owner/other-repo/issues/46 Fix redirect
`);

  assertEquals(items, [
    {
      checked: false,
      score: 1,
      ref: "#45",
      title: "Add login button",
    },
    {
      checked: true,
      score: 3,
      ref: "https://github.com/owner/other-repo/issues/46",
      title: "Fix redirect",
    },
  ]);
});
