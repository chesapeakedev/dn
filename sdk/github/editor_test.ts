// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { openInEditor, reviewInEditor, reviewTextInEditor } from "./editor.ts";
import { setUnattended } from "./output.ts";

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
  name: "reviewInEditor skips EDITOR in unattended mode",
  permissions: { env: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    try {
      Deno.env.set("EDITOR", "false");
      setUnattended(true);
      assertEquals(await reviewInEditor("missing-plan.md"), false);
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      setUnattended(false);
    }
  },
});

Deno.test({
  name: "reviewTextInEditor returns original content when unattended",
  permissions: { env: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    try {
      Deno.env.set("EDITOR", "false");
      setUnattended(true);
      assertEquals(
        await reviewTextInEditor({ content: "## Summary\n\nKeep headings.\n" }),
        "## Summary\n\nKeep headings.\n",
      );
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      setUnattended(false);
    }
  },
});

Deno.test({
  name: "reviewTextInEditor returns original content when EDITOR is unset",
  permissions: { env: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    try {
      Deno.env.delete("EDITOR");
      setUnattended(false);
      assertEquals(
        await reviewTextInEditor({ content: "agent draft" }),
        "agent draft",
      );
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      setUnattended(false);
    }
  },
});

Deno.test({
  name:
    "reviewTextInEditor re-reads a persist path after the editor mutates it",
  permissions: { env: true, read: true, run: true, write: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    const directory = await Deno.makeTempDir({ prefix: "dn-editor-test-" });
    const draftPath = `${directory}/staging.md`;
    try {
      const editorPath = `${directory}/editor.sh`;
      await Deno.writeTextFile(
        editorPath,
        '#!/bin/sh\nprintf "reviewed ## Heading\\n" > "$1"\n',
      );
      await Deno.chmod(editorPath, 0o755);
      Deno.env.set("EDITOR", editorPath);
      setUnattended(false);

      const reviewed = await reviewTextInEditor({
        content: "agent draft",
        path: draftPath,
      });
      assertEquals(reviewed, "reviewed ## Heading\n");
      assertEquals(await Deno.readTextFile(draftPath), "reviewed ## Heading\n");
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      setUnattended(false);
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "reviewTextInEditor uses a temp file when no persist path is given",
  permissions: { env: true, read: true, run: true, write: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    const directory = await Deno.makeTempDir({ prefix: "dn-editor-test-" });
    try {
      const editorPath = `${directory}/editor.sh`;
      await Deno.writeTextFile(
        editorPath,
        '#!/bin/sh\nprintf "%s" "from-temp" > "$1"\n',
      );
      await Deno.chmod(editorPath, 0o755);
      Deno.env.set("EDITOR", editorPath);
      setUnattended(false);

      const reviewed = await reviewTextInEditor({
        content: "before",
      });
      assertEquals(reviewed, "from-temp");
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      setUnattended(false);
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "reviewTextInEditor propagates editor failures",
  permissions: { env: true, read: true, write: true, run: true },
  async fn() {
    const previousEditor = Deno.env.get("EDITOR");
    const directory = await Deno.makeTempDir({ prefix: "dn-editor-test-" });
    try {
      Deno.env.set("EDITOR", "false");
      setUnattended(false);
      await assertRejects(() =>
        reviewTextInEditor({
          content: "agent draft",
          path: `${directory}/draft.md`,
        })
      );
    } finally {
      restoreEnvironment("EDITOR", previousEditor);
      setUnattended(false);
      await Deno.remove(directory, { recursive: true });
    }
  },
});
