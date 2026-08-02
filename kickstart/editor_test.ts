// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { openInEditor, reviewPlanInEditor } from "./editor.ts";
import { setUnattended } from "../sdk/github/output.ts";

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
}

Deno.test({
  name: "openInEditor skips when EDITOR is unset",
  permissions: { env: true, read: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    try {
      Deno.env.delete("EDITOR");
      assertEquals(await openInEditor("missing-plan.md"), false);
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
    }
  },
});

Deno.test({
  name: "openInEditor supports arguments and filters secret environment keys",
  permissions: { env: true, read: true, run: true, write: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    const previousOpenAiKey = Deno.env.get("OPENAI_API_KEY");
    const directory = await Deno.makeTempDir({ prefix: "dn-editor-test-" });
    const planDirectory = `${directory}/plan with spaces`;
    await Deno.mkdir(planDirectory);
    const planPath = `${planDirectory}/plan.md`;
    try {
      await Deno.writeTextFile(planPath, "before");
      const editorPath = `${directory}/editor.sh`;
      await Deno.writeTextFile(
        editorPath,
        '#!/bin/sh\n[ "$1" = "--test-flag" ] || exit 2\nprintf "%s" "${OPENAI_API_KEY-unset}" > "$2"\n',
      );
      await Deno.chmod(editorPath, 0o755);
      Deno.env.set("EDITOR", `${editorPath} --test-flag`);
      Deno.env.set("OPENAI_API_KEY", "secret-value");

      assertEquals(await openInEditor(planPath), true);
      assertEquals(await Deno.readTextFile(planPath), "unset");
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      restoreEnvironment("OPENAI_API_KEY", previousOpenAiKey);
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "openInEditor propagates editor failures",
  permissions: { env: true, run: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    try {
      Deno.env.set("EDITOR", "false");
      await assertRejects(() => openInEditor("missing-plan.md"));
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
    }
  },
});

Deno.test({
  name: "reviewPlanInEditor skips EDITOR in unattended mode",
  permissions: { env: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    try {
      Deno.env.set("EDITOR", "false");
      setUnattended(true);
      assertEquals(await reviewPlanInEditor("missing-plan.md"), false);
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      setUnattended(false);
    }
  },
});
