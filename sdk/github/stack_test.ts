// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  formatStackArtifactId,
  getStackArtifactPaths,
  markMilestoneStackItemDone,
  mergeStackCheckmarks,
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

Deno.test("markMilestoneStackItemDone checks off matching line", async () => {
  const path = await Deno.makeTempFile({ suffix: ".stack.md" });
  try {
    await Deno.writeTextFile(
      path,
      `---
milestone: 1
repo: owner/repo
---

# Milestone

- [ ] 1 #45 First task
- [ ] 2 #46 Second task
`,
    );
    await markMilestoneStackItemDone(path, "#45");
    const out = await Deno.readTextFile(path);
    assertEquals(out.includes("- [x] 1 #45 First task"), true);
    assertEquals(out.includes("- [ ] 2 #46 Second task"), true);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("mergeStackCheckmarks preserves completed items", () => {
  const existing = `---
milestone: 1
---

- [x] 1 #45 Done task
- [ ] 2 #46 Pending task
`;
  const regenerated = `---
milestone: 1
---

- [ ] 3 #45 Done task
- [ ] 1 #46 Pending task
- [ ] 2 #47 New task
`;
  const merged = mergeStackCheckmarks(regenerated, existing);
  assertEquals(merged.includes("- [x] 3 #45 Done task"), true);
  assertEquals(merged.includes("- [ ] 1 #46 Pending task"), true);
  assertEquals(merged.includes("- [ ] 2 #47 New task"), true);
});

Deno.test("markMilestoneStackItemDone throws when ref not in stack", async () => {
  const path = await Deno.makeTempFile({ suffix: ".stack.md" });
  try {
    await Deno.writeTextFile(
      path,
      `---
milestone: 1
---

- [ ] 1 #99 Only here
`,
    );
    await assertRejects(() => markMilestoneStackItemDone(path, "#45"));
  } finally {
    await Deno.remove(path);
  }
});
