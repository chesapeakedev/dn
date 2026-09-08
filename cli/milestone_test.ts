// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { handleMilestone } from "./milestone.ts";

Deno.test("milestone publish supports dry-run plans from the CLI", async () => {
  const planPath = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(
      planPath,
      JSON.stringify({
        schema_version: "1.0",
        repo: "owner/repo",
        milestone: { title: "CLI test" },
        issues: [{ id: "issue", title: "Issue", body: "Body" }],
      }),
    );
    await handleMilestone(["publish", planPath, "--dry-run", "--json"]);
  } finally {
    await Deno.remove(planPath);
  }
});
