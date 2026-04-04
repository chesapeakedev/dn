// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  expandAssetPaths,
  matchesSimpleGlob,
  parseAssetArgs,
  stripUploadUrlTemplate,
} from "./api.ts";
import { resolveAssets } from "./assets.ts";

Deno.test("parseAssetArgs handles plain paths", () => {
  const assets = parseAssetArgs(["./dist/app.tar.gz", "./dist/cli.zip"]);
  assertEquals(assets.length, 2);
  assertEquals(assets[0].path, "./dist/app.tar.gz");
  assertEquals(assets[0].label, undefined);
  assertEquals(assets[1].path, "./dist/cli.zip");
  assertEquals(assets[1].label, undefined);
});

Deno.test("parseAssetArgs handles labels", () => {
  const assets = parseAssetArgs([
    "./dist/app.tar.gz#Linux Binary",
    "./dist/cli.zip#CLI Archive",
  ]);
  assertEquals(assets.length, 2);
  assertEquals(assets[0].path, "./dist/app.tar.gz");
  assertEquals(assets[0].label, "Linux Binary");
  assertEquals(assets[1].path, "./dist/cli.zip");
  assertEquals(assets[1].label, "CLI Archive");
});

Deno.test("parseAssetArgs handles empty labels", () => {
  const assets = parseAssetArgs(["./file.tar.gz#"]);
  assertEquals(assets.length, 1);
  assertEquals(assets[0].path, "./file.tar.gz");
  assertEquals(assets[0].label, undefined);
});

Deno.test("stripUploadUrlTemplate removes template suffix", () => {
  const url =
    "https://uploads.github.com/repos/owner/repo/releases/123/assets{?name,label}";
  assertEquals(
    stripUploadUrlTemplate(url),
    "https://uploads.github.com/repos/owner/repo/releases/123/assets",
  );
});

Deno.test("stripUploadUrlTemplate passes through plain URLs", () => {
  const url = "https://example.com/upload";
  assertEquals(stripUploadUrlTemplate(url), url);
});

Deno.test("matchesSimpleGlob matches star wildcard", () => {
  assertEquals(matchesSimpleGlob("file.tar.gz", "*.tar.gz"), true);
  assertEquals(matchesSimpleGlob("file.zip", "*.tar.gz"), false);
  assertEquals(matchesSimpleGlob("app.tar.gz", "app.*"), true);
  assertEquals(matchesSimpleGlob("app.zip", "app.*"), true);
});

Deno.test("matchesSimpleGlob matches question mark wildcard", () => {
  assertEquals(matchesSimpleGlob("f1.txt", "f?.txt"), true);
  assertEquals(matchesSimpleGlob("file.txt", "f?.txt"), false);
});

Deno.test("matchesSimpleGlob matches exact strings", () => {
  assertEquals(matchesSimpleGlob("exact.txt", "exact.txt"), true);
  assertEquals(matchesSimpleGlob("other.txt", "exact.txt"), false);
});

Deno.test("expandAssetPaths expands glob patterns", async () => {
  // Create temp directory with test files
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmpDir}/a.tar.gz`, "content");
    await Deno.writeTextFile(`${tmpDir}/b.tar.gz`, "content");
    await Deno.writeTextFile(`${tmpDir}/c.zip`, "content");

    const assets = await expandAssetPaths([
      { path: `${tmpDir}/*.tar.gz` },
    ]);

    assertEquals(assets.length, 2);
    const paths = assets.map((a) => a.path).sort();
    assertEquals(paths, [`${tmpDir}/a.tar.gz`, `${tmpDir}/b.tar.gz`]);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("expandAssetPaths passes through non-glob paths", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const filePath = `${tmpDir}/single.txt`;
    await Deno.writeTextFile(filePath, "content");

    const assets = await expandAssetPaths([{ path: filePath }]);
    assertEquals(assets.length, 1);
    assertEquals(assets[0].path, filePath);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("expandAssetPaths preserves labels", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmpDir}/file.tar.gz`, "content");

    const assets = await expandAssetPaths([
      { path: `${tmpDir}/file.tar.gz`, label: "My Asset" },
    ]);

    assertEquals(assets.length, 1);
    assertEquals(assets[0].label, "My Asset");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveAssets validates file existence", async () => {
  await assertRejects(
    async () => {
      await resolveAssets(["/nonexistent/path/file.tar.gz"]);
    },
    Error,
    "Asset file not found",
  );
});
