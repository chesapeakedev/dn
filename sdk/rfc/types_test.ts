// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  generateRfcFilename,
  isValidStatusTransition,
  parseRfcIdFromFilename,
  parseRfcSlugFromFilename,
} from "./types.ts";
import {
  createRfcContent,
  parseRfcMetadata,
  updateRfcContent,
} from "./parser.ts";
import {
  findRfc,
  listRfcsFromState,
  loadState,
  saveState,
  updateRfcInState,
} from "./state.ts";

Deno.test("generateRfcFilename", () => {
  assertEquals(generateRfcFilename(1, "My RFC Title"), "001-my-rfc-title.md");
  assertEquals(generateRfcFilename(42, "API Design"), "042-api-design.md");
  assertEquals(generateRfcFilename(123, "Test-Slug"), "123-test-slug.md");
  assertEquals(
    generateRfcFilename(7, "Test & Special! Chars"),
    "007-test-special-chars.md",
  );
  assertThrows(
    () => generateRfcFilename(1, "!!!"),
    Error,
    "alphanumeric",
  );
});

Deno.test("parseRfcIdFromFilename", () => {
  assertEquals(parseRfcIdFromFilename("001-my-rfc-title.md"), 1);
  assertEquals(parseRfcIdFromFilename("042-api-design.md"), 42);
  assertEquals(parseRfcIdFromFilename("not-a-valid-filename.md"), null);
  assertEquals(parseRfcIdFromFilename("1-short-id.md"), null);
});

Deno.test("parseRfcSlugFromFilename", () => {
  assertEquals(parseRfcSlugFromFilename("001-my-rfc-title.md"), "my-rfc-title");
  assertEquals(parseRfcSlugFromFilename("042-api-design.md"), "api-design");
  assertEquals(parseRfcSlugFromFilename("not-a-valid-filename.md"), null);
});

Deno.test("isValidStatusTransition", () => {
  assertEquals(isValidStatusTransition("draft", "review"), true);
  assertEquals(isValidStatusTransition("draft", "done"), true);
  assertEquals(isValidStatusTransition("done", "superseded"), true);
  assertEquals(isValidStatusTransition("done", "draft"), false);
  assertEquals(isValidStatusTransition("superseded", "done"), false);
  assertEquals(isValidStatusTransition("draft", "draft"), true);
});

Deno.test("parseRfcMetadata valid", () => {
  const content = `---
id: 42
title: "Test RFC"
status: draft
github_issue: "https://github.com/owner/repo/issues/123"
---

# Test RFC
`;
  assertEquals(parseRfcMetadata(content), {
    id: 42,
    title: "Test RFC",
    status: "draft",
    githubIssue: "https://github.com/owner/repo/issues/123",
  });
});

Deno.test("parseRfcMetadata accepts id 0", () => {
  const content = `---
id: 0
title: "Overview"
status: draft
---
`;
  assertEquals(parseRfcMetadata(content)?.id, 0);
});

Deno.test("parseRfcMetadata missing fields", () => {
  const content = `---
id: 42
title: "Test RFC"
---
`;
  assertEquals(parseRfcMetadata(content), null);
});

Deno.test("parseRfcMetadata invalid status", () => {
  const content = `---
id: 42
title: "Test RFC"
status: invalid
---
`;
  assertThrows(
    () => parseRfcMetadata(content),
    Error,
    "Invalid RFC status: invalid",
  );
});

Deno.test("createRfcContent", () => {
  const content = createRfcContent({
    id: 42,
    title: "Test RFC",
    status: "draft",
    githubIssue: "https://github.com/owner/repo/issues/123",
  });
  assertEquals(
    content,
    `---
id: 42
title: "Test RFC"
status: draft
github_issue: "https://github.com/owner/repo/issues/123"
---
`,
  );
});

Deno.test("updateRfcContent preserves body and extra keys", () => {
  const original = `---
id: 42
title: "Old Title"
status: draft
extra: value
---

# Existing content
`;
  const updated = updateRfcContent(original, {
    id: 42,
    title: "New Title",
    status: "accepted",
  });
  assertEquals(updated.includes('title: "New Title"'), true);
  assertEquals(updated.includes("status: accepted"), true);
  assertEquals(updated.includes("extra: value"), true);
  assertEquals(updated.includes("# Existing content"), true);
});

Deno.test("state allocates ids and findRfc resolves slug from path", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-rfc-state-" });
  try {
    await Deno.writeTextFile(
      join(root, "dn.json"),
      JSON.stringify({ schema_version: "2.0", rfc: { dir: "docs/rfcs" } }),
    );
    const options = { repoRoot: root };
    await saveState({ nextId: 1, rfcs: {} }, options);
    const path = "docs/rfcs/001-api-design.md";
    await Deno.mkdir(join(root, "docs/rfcs"), { recursive: true });
    await Deno.writeTextFile(
      join(root, path),
      createRfcContent(
        { id: 1, title: "API Design", status: "draft" },
        "# API Design\n",
      ),
    );
    await updateRfcInState({
      metadata: { id: 1, title: "API Design", status: "draft" },
      path,
      contentHash: "abc",
    }, options);

    const state = await loadState(options);
    assertEquals(state.nextId, 2);
    assertEquals((await listRfcsFromState(options)).length, 1);

    assertEquals((await findRfc("1", options))?.metadata.title, "API Design");
    assertEquals(
      (await findRfc("api-design", options))?.path,
      path,
    );
    assertEquals(
      (await findRfc("001-api-design.md", options))?.metadata.id,
      1,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("loadState fails clearly on corrupt state", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-rfc-bad-state-" });
  try {
    await Deno.mkdir(join(root, "rfcs"), { recursive: true });
    await Deno.writeTextFile(join(root, "rfcs/.state.json"), "{");
    await assertRejects(
      () => loadState({ repoRoot: root }),
      Error,
      "Failed to load RFC state",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
