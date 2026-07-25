// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { synchronizeWorkflowChecksums } from "./workflowChecksums.ts";

interface WorkflowFixture {
  repoRoot: string;
  manifestPath: string;
}

async function createWorkflowFixture(): Promise<WorkflowFixture> {
  const repoRoot = await Deno.makeTempDir({
    prefix: "dn-workflow-checksums-",
  });
  const workflowRoot = join(repoRoot, "templates", "workflows");
  await Deno.mkdir(workflowRoot, { recursive: true });
  await Deno.writeTextFile(join(workflowRoot, "first.yml"), "name: first\n");
  await Deno.writeTextFile(join(workflowRoot, "second.yml"), "name: second\n");
  await Deno.writeTextFile(
    join(repoRoot, "compile_dn.sh"),
    [
      '  --include "${WORKFLOW_TEMPLATE_DIR}/first.yml"',
      '  --include "${WORKFLOW_TEMPLATE_DIR}/second.yml"',
      "",
    ].join("\n"),
  );
  const manifestPath = join(workflowRoot, "manifest.json");
  await Deno.writeTextFile(
    manifestPath,
    `${
      JSON.stringify(
        {
          templates: [
            {
              id: "dn.first",
              source_path: "templates/workflows/first.yml",
              checksum: `sha256:${"0".repeat(64)}`,
            },
            {
              id: "dn.second",
              source_path: "templates/workflows/second.yml",
              checksum: `sha256:${"1".repeat(64)}`,
            },
          ],
        },
        null,
        2,
      )
    }\n`,
  );
  return { repoRoot, manifestPath };
}

Deno.test("workflow checksums check without modifying stale manifest", async () => {
  const fixture = await createWorkflowFixture();
  try {
    const before = await Deno.readTextFile(fixture.manifestPath);
    const result = await synchronizeWorkflowChecksums(
      fixture.repoRoot,
      "check",
    );

    assertEquals(result.mismatches.length, 2);
    assertEquals(result.written, false);
    assertEquals(await Deno.readTextFile(fixture.manifestPath), before);
  } finally {
    await Deno.remove(fixture.repoRoot, { recursive: true });
  }
});

Deno.test("workflow checksums write stale values and preserve formatting", async () => {
  const fixture = await createWorkflowFixture();
  try {
    const before = await Deno.readTextFile(fixture.manifestPath);
    const written = await synchronizeWorkflowChecksums(
      fixture.repoRoot,
      "write",
    );
    const after = await Deno.readTextFile(fixture.manifestPath);
    const checked = await synchronizeWorkflowChecksums(
      fixture.repoRoot,
      "check",
    );

    assertEquals(written.mismatches.length, 2);
    assertEquals(written.written, true);
    assertEquals(checked.mismatches, []);
    assertEquals(
      after.replaceAll(/sha256:[0-9a-f]{64}/g, "sha256:<checksum>"),
      before.replaceAll(/sha256:[0-9a-f]{64}/g, "sha256:<checksum>"),
    );
  } finally {
    await Deno.remove(fixture.repoRoot, { recursive: true });
  }
});

Deno.test("workflow checksums reject unlisted workflow templates", async () => {
  const fixture = await createWorkflowFixture();
  try {
    await Deno.writeTextFile(
      join(fixture.repoRoot, "templates", "workflows", "unlisted.yml"),
      "name: unlisted\n",
    );

    await assertRejects(
      () => synchronizeWorkflowChecksums(fixture.repoRoot, "check"),
      Error,
      "unlisted templates: templates/workflows/unlisted.yml",
    );
  } finally {
    await Deno.remove(fixture.repoRoot, { recursive: true });
  }
});

Deno.test("workflow checksums reject an omitted compiled template", async () => {
  const fixture = await createWorkflowFixture();
  try {
    await Deno.writeTextFile(
      join(fixture.repoRoot, "compile_dn.sh"),
      '  --include "${WORKFLOW_TEMPLATE_DIR}/first.yml"\n',
    );

    await assertRejects(
      () => synchronizeWorkflowChecksums(fixture.repoRoot, "check"),
      Error,
      "omitted templates: templates/workflows/second.yml",
    );
  } finally {
    await Deno.remove(fixture.repoRoot, { recursive: true });
  }
});
