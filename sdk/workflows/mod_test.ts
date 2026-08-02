// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { installWorkflowSupport } from "./agentConfig.ts";
import {
  computeSha256,
  installWorkflowTemplates,
  listWorkflowStatuses,
  loadWorkflowManifest,
  readWorkflowTemplate,
  removeRetiredTodoLoopWorkflow,
  updateWorkflowTemplates,
  validateWorkflowInstallation,
} from "./mod.ts";

Deno.test("workflow manifest checksums match shipped templates", async () => {
  const manifest = await loadWorkflowManifest();

  for (const template of manifest.templates) {
    const content = await readWorkflowTemplate(template);
    assertEquals(await computeSha256(content), template.checksum);
  }
});

Deno.test("canonical workflows delegate runtime setup to one action step", async () => {
  const manifest = await loadWorkflowManifest();
  for (const template of manifest.templates) {
    const content = await readWorkflowTemplate(template);
    assertStringIncludes(content, "uses: chesapeakedev/dn-action@v1");
    assertStringIncludes(
      content,
      "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    );
    if (template.id === "dn.meld_issue_plan") {
      assertStringIncludes(content, "workflow: ${{ github.event.action }}");
      // Bridge for older dn binaries that require DN_YES for GitHub issue targets.
      assertStringIncludes(content, 'DN_YES: "1"');
    } else {
      assertStringIncludes(content, `workflow: ${template.id}`);
    }
    assertFalse(content.includes("actions/checkout"));
    assertFalse(content.includes("install-agent.sh"));
    assertFalse(content.includes("git push"));
    assertFalse(content.includes("git commit"));
  }
});

Deno.test("workflow install, update, and validate report expected status", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-workflows-" });
  try {
    let statuses = await listWorkflowStatuses(repoRoot);
    assertEquals(statuses.map((status) => status.status), [
      "missing",
      "missing",
      "missing",
      "missing",
    ]);

    await installWorkflowSupport(repoRoot, { agent: "opencode" });
    const installed = await installWorkflowTemplates(repoRoot);
    assertEquals(installed.length, 4);

    statuses = await listWorkflowStatuses(repoRoot);
    assertEquals(statuses.map((status) => status.status), [
      "current",
      "current",
      "current",
      "current",
    ]);

    await Deno.writeTextFile(
      `${repoRoot}/.github/workflows/dn-init-stack.yml`,
      "name: edited\n",
    );
    statuses = await listWorkflowStatuses(repoRoot);
    assertEquals(statuses[0].status, "outdated");

    const updated = await updateWorkflowTemplates(repoRoot);
    assertEquals(updated.length, 1);

    const validation = await validateWorkflowInstallation(repoRoot);
    assertEquals(validation.ok, true);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("install removes retired todo-loop workflow", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-retire-todo-" });
  try {
    await Deno.mkdir(`${repoRoot}/.github/workflows`, { recursive: true });
    await Deno.writeTextFile(
      `${repoRoot}/.github/workflows/dn-todo-loop.yml`,
      "name: retired\n",
    );
    assertEquals(
      await removeRetiredTodoLoopWorkflow(repoRoot),
      "removed",
    );
    assertEquals(
      await removeRetiredTodoLoopWorkflow(repoRoot),
      "missing",
    );

    await Deno.writeTextFile(
      `${repoRoot}/.github/workflows/dn-todo-loop.yml`,
      "name: retired\n",
    );
    await installWorkflowTemplates(repoRoot);
    try {
      await Deno.stat(`${repoRoot}/.github/workflows/dn-todo-loop.yml`);
      throw new Error("expected retired workflow to be deleted");
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true);
    }
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
