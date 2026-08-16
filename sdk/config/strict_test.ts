// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { checkStrictRfcCorpus, isStrictRfcRequired } from "./strict.ts";

async function writeDnJson(
  root: string,
  document: Record<string, unknown>,
): Promise<void> {
  await Deno.writeTextFile(
    join(root, "dn.json"),
    `${JSON.stringify(document, null, 2)}\n`,
  );
}

async function writeRfcState(
  root: string,
  rfcs: Record<
    string,
    { path: string; metadata: Record<string, unknown>; contentHash: string }
  >,
): Promise<void> {
  const dir = join(root, "rfcs");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".state.json"),
    `${JSON.stringify({ nextId: 2, rfcs }, null, 2)}\n`,
  );
}

Deno.test("isStrictRfcRequired is false by default", () => {
  assertEquals(isStrictRfcRequired(undefined), false);
  assertEquals(isStrictRfcRequired({ enabled: true }), false);
  assertEquals(isStrictRfcRequired({ require_rfcs: true }), false);
  assertEquals(
    isStrictRfcRequired({ enabled: false, require_rfcs: true }),
    false,
  );
});

Deno.test("isStrictRfcRequired is true only when both flags are set", () => {
  assertEquals(
    isStrictRfcRequired({ enabled: true, require_rfcs: true }),
    true,
  );
});

Deno.test("checkStrictRfcCorpus skips when strict block is absent", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-strict-" });
  try {
    const result = await checkStrictRfcCorpus(root);
    assertEquals(result, { ok: true });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkStrictRfcCorpus skips when strict.enabled without require_rfcs", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-strict-" });
  try {
    await writeDnJson(root, {
      schema_version: "2.0",
      strict: { enabled: true },
    });
    const result = await checkStrictRfcCorpus(root);
    assertEquals(result, { ok: true });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkStrictRfcCorpus fails when rfcs directory is missing", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-strict-" });
  try {
    await writeDnJson(root, {
      schema_version: "2.0",
      strict: { enabled: true, require_rfcs: true },
    });
    const result = await checkStrictRfcCorpus(root);
    assertEquals(result.ok, false);
    assert(result.error?.includes("RFC directory not found"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkStrictRfcCorpus fails when corpus is empty", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-strict-" });
  try {
    await writeDnJson(root, {
      schema_version: "2.0",
      strict: { enabled: true, require_rfcs: true },
    });
    await Deno.mkdir(join(root, "rfcs"), { recursive: true });
    const result = await checkStrictRfcCorpus(root);
    assertEquals(result.ok, false);
    assert(result.error?.includes("corpus is empty"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkStrictRfcCorpus fails when all RFCs are draft", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-strict-" });
  try {
    await writeDnJson(root, {
      schema_version: "2.0",
      strict: { enabled: true, require_rfcs: true },
    });
    await writeRfcState(root, {
      "1": {
        path: "rfcs/001-auth.md",
        metadata: { id: 1, title: "Auth", status: "draft" },
        contentHash: "abc",
      },
    });
    const result = await checkStrictRfcCorpus(root);
    assertEquals(result.ok, false);
    assert(result.error?.includes("still draft"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkStrictRfcCorpus skips bare enabled without require_rfcs", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-strict-" });
  try {
    await writeDnJson(root, {
      schema_version: "2.0",
      agent: "opencode",
      strict: { enabled: true },
    });
    const result = await checkStrictRfcCorpus(root);
    assertEquals(result, { ok: true });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkStrictRfcCorpus passes with a non-draft RFC", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-strict-" });
  try {
    await writeDnJson(root, {
      schema_version: "2.0",
      strict: { enabled: true, require_rfcs: true },
    });
    await writeRfcState(root, {
      "1": {
        path: "rfcs/001-auth.md",
        metadata: { id: 1, title: "Auth", status: "review" },
        contentHash: "abc",
      },
    });
    const result = await checkStrictRfcCorpus(root);
    assertEquals(result, { ok: true });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
