// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
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

Deno.test("workflow install, update, and validate report expected status", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-workflows-" });
  try {
    let statuses = await listWorkflowStatuses(repoRoot);
    assertEquals(statuses.map((status) => status.status), [
      "missing",
      "missing",
      "missing",
    ]);

    const installed = await installWorkflowTemplates(repoRoot);
    assertEquals(installed.length, 3);

    statuses = await listWorkflowStatuses(repoRoot);
    assertEquals(statuses.map((status) => status.status), [
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
