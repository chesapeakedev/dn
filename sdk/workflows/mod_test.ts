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
    if (template.id === "dn.meld_issue_plan") {
      assertStringIncludes(content, "workflow: ${{ github.event.action }}");
    } else {
      assertStringIncludes(content, `workflow: ${template.id}`);
    }
    assertFalse(content.includes("actions/checkout"));
    assertFalse(content.includes("install-agent.sh"));
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
      "missing",
    ]);

    await installWorkflowSupport(repoRoot, { agent: "opencode" });
    const installed = await installWorkflowTemplates(repoRoot);
    assertEquals(installed.length, 5);

    statuses = await listWorkflowStatuses(repoRoot);
    assertEquals(statuses.map((status) => status.status), [
      "current",
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
