// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { parseResearchArgs } from "./research.ts";

Deno.test("parseResearchArgs rejects bare issue numbers", async () => {
  await assertRejects(
    () => parseResearchArgs(["123"], null, null, []),
    Error,
    "Bare numbers",
  );
});

Deno.test("parseResearchArgs accepts a full GitHub issue URL", async () => {
  const { config, help } = await parseResearchArgs(
    [
      "https://github.com/owner/repo/issues/42",
    ],
    null,
    null,
    [],
  );
  assertEquals(help, false);
  assertEquals(config.issueUrl, "https://github.com/owner/repo/issues/42");
  assertEquals(config.outputPath ?? null, null);
});

Deno.test("parseResearchArgs maps --plan-name to plans artifact path", async () => {
  const { config } = await parseResearchArgs(
    [
      "--plan-name",
      "my-feature",
      "https://github.com/owner/repo/issues/1",
    ],
    null,
    null,
    [],
  );
  assertEquals(config.outputPath, "plans/my-feature.research.md");
});

Deno.test("parseResearchArgs rejects --publish", async () => {
  await assertRejects(
    () =>
      parseResearchArgs(
        ["--publish", "pr", "https://github.com/o/r/issues/1"],
        null,
        null,
        [],
      ),
    Error,
    "does not accept --publish",
  );
});

Deno.test("parseResearchArgs accepts local markdown path", async () => {
  const { config } = await parseResearchArgs(
    ["spec.md"],
    null,
    null,
    [],
  );
  assertEquals(config.issueUrl, null);
  assertEquals(config.contextMarkdownPath, "spec.md");
});
