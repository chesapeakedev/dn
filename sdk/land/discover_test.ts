// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { discoverRfcForLand, isPlanLandTarget } from "./discover.ts";
import { saveState } from "../rfc/state.ts";
import { writeRfc } from "../rfc/parser.ts";

Deno.test("isPlanLandTarget identifies execution plans", () => {
  assertEquals(isPlanLandTarget("plans/issue-123.plan.md"), true);
  assertEquals(isPlanLandTarget("rfcs/001-api-design.md"), false);
  assertEquals(isPlanLandTarget("1"), false);
});

Deno.test("discoverRfcForLand resolves RFC refs and rejects plan paths", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-land-discover-" });
  const previous = Deno.cwd();
  try {
    Deno.chdir(root);
    await Deno.mkdir(join(root, "rfcs"), { recursive: true });
    const rfcPath = "rfcs/001-api-design.md";
    await writeRfc(
      join(root, rfcPath),
      { id: 1, title: "API Design", status: "implementing" },
      "# API Design\n",
    );
    await saveState({
      nextId: 2,
      rfcs: {
        "1": {
          path: rfcPath,
          metadata: { id: 1, title: "API Design", status: "implementing" },
          contentHash: "abc",
        },
      },
    }, { repoRoot: root });

    assertEquals(
      await discoverRfcForLand("plans/foo.plan.md", { repoRoot: root }),
      null,
    );
    assertEquals(
      (await discoverRfcForLand("1", { repoRoot: root }))?.path,
      rfcPath,
    );
    assertEquals(
      (await discoverRfcForLand("api-design", { repoRoot: root }))?.path,
      rfcPath,
    );
    assertEquals(
      (await discoverRfcForLand(rfcPath, { repoRoot: root }))?.path,
      rfcPath,
    );
  } finally {
    Deno.chdir(previous);
    await Deno.remove(root, { recursive: true });
  }
});
