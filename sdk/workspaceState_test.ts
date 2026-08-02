// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  ensureWorkspaceStateDir,
  LOCAL_COMPILE_BINARY_RELATIVE_PATH,
  workspaceStateDir,
} from "./workspaceState.ts";

const TEST_ROOT = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  ".tmp-workspace-state-tests",
);

async function withTempWorkspace(
  name: string,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = join(TEST_ROOT, name);
  await Deno.remove(root, { recursive: true }).catch(() => {});
  await Deno.mkdir(root, { recursive: true });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("ensureWorkspaceStateDir creates .dn when missing", async () => {
  await withTempWorkspace("create", async (root) => {
    const dir = await ensureWorkspaceStateDir(root);
    assertEquals(dir, workspaceStateDir(root));
    const st = await Deno.stat(dir);
    assertEquals(st.isDirectory, true);
  });
});

Deno.test(
  "ensureWorkspaceStateDir migrates a legacy .dn binary to bin/dn",
  async () => {
    await withTempWorkspace("migrate", async (root) => {
      const legacy = join(root, ".dn");
      await Deno.writeTextFile(legacy, "fake-binary");
      const warn = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      try {
        const dir = await ensureWorkspaceStateDir(root);
        assertEquals((await Deno.stat(dir)).isDirectory, true);
        assertEquals(
          await Deno.readTextFile(
            join(root, LOCAL_COMPILE_BINARY_RELATIVE_PATH),
          ),
          "fake-binary",
        );
        assertStringIncludes(
          warnings.join("\n"),
          "Moved legacy compile artifact",
        );
      } finally {
        console.warn = warn;
      }
    });
  },
);

Deno.test(
  "ensureWorkspaceStateDir removes legacy .dn when bin/dn already exists",
  async () => {
    await withTempWorkspace("remove-legacy", async (root) => {
      await Deno.mkdir(join(root, "bin"), { recursive: true });
      await Deno.writeTextFile(join(root, "bin", "dn"), "kept");
      await Deno.writeTextFile(join(root, ".dn"), "stale");
      const warn = console.warn;
      console.warn = () => {};
      try {
        const dir = await ensureWorkspaceStateDir(root);
        assertEquals((await Deno.stat(dir)).isDirectory, true);
        assertEquals(await Deno.readTextFile(join(root, "bin", "dn")), "kept");
      } finally {
        console.warn = warn;
      }
    });
  },
);
