// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { handleRfc } from "./rfc.ts";

async function withTempCwd(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dn-rfc-cli-" });
  const previous = Deno.cwd();
  try {
    Deno.chdir(root);
    await fn(root);
  } finally {
    Deno.chdir(previous);
    await Deno.remove(root, { recursive: true });
  }
}

async function capture(
  fn: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    stdoutChunks.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderrChunks.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return {
    stdout: stdoutChunks.join("\n"),
    stderr: stderrChunks.join("\n"),
  };
}

Deno.test("dn rfc CLI smoke: init/create/list/show/status/complete", async () => {
  await withTempCwd(async (root) => {
    await capture(() => handleRfc(["init"]));
    assertEquals(
      await Deno.stat(join(root, "rfcs/.state.json")).then(() => true),
      true,
    );
    assertEquals(
      await Deno.stat(join(root, "rfcs/000-overview.md")).then(() => true),
      true,
    );

    await capture(() =>
      handleRfc(["create", "--title", "API Design", "--slug", "api-design"])
    );
    const created = join(root, "rfcs/001-api-design.md");
    assertEquals(await Deno.stat(created).then(() => true), true);

    const listed = await capture(() => handleRfc(["list", "--json"]));
    const rows = JSON.parse(listed.stdout) as Array<
      { id: number; status: string }
    >;
    assertEquals(rows.length, 1);
    assertEquals(rows[0].id, 1);
    assertEquals(rows[0].status, "draft");

    const shown = await capture(() => handleRfc(["show", "api-design"]));
    assertEquals(shown.stdout.includes("API Design"), true);

    await capture(() => handleRfc(["status", "1", "review"]));
    const afterStatus = JSON.parse(
      (await capture(() => handleRfc(["list", "--json"]))).stdout,
    ) as Array<{ status: string }>;
    assertEquals(afterStatus[0].status, "review");

    await capture(() => handleRfc(["complete", "1"]));
    const afterComplete = JSON.parse(
      (await capture(() => handleRfc(["list", "--json"]))).stdout,
    ) as Array<{ status: string; path: string }>;
    assertEquals(afterComplete[0].status, "done");
    // complete must not delete the file
    assertEquals(await Deno.stat(created).then(() => true), true);

    // init is idempotent and does not wipe state
    await capture(() => handleRfc(["init"]));
    const stillThere = JSON.parse(
      (await capture(() => handleRfc(["list", "--json"]))).stdout,
    ) as unknown[];
    assertEquals(stillThere.length, 1);
  });
});
