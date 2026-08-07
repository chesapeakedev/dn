// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { toDnActionsConfig } from "./actions.ts";
import { parseDnConfig } from "./parse.ts";
import { resolveDnConfig } from "./resolve.ts";

Deno.test("resolveDnConfig applies repository, environment, and CLI precedence", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-config-" });
  const user = `${root}/user.json`;
  try {
    await Deno.writeTextFile(
      user,
      JSON.stringify({ schema_version: "2.0", agent: "claude" }),
    );
    await Deno.writeTextFile(
      `${root}/dn.json`,
      JSON.stringify({ schema_version: "2.0", agent: "cursor" }),
    );
    const config = await resolveDnConfig({
      repoRoot: root,
      userConfigPath: user,
      env: { DN_AGENT: "codex" },
      cli: { agent: "copilot" },
    });
    assertEquals(config.agent, "copilot");
    assertEquals(config.sources.agent, "cli");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Actions config excludes secrets and user config", () => {
  const output = toDnActionsConfig({
    schema_version: "2.0",
    agent: "opencode",
    sandbox: undefined,
    sources: { agent: "repository" },
  });
  assertEquals(output, { schema_version: "2.0", agent: "opencode" });
});

Deno.test("parseDnConfig rejects malformed and unsupported documents", () => {
  assertThrows(() => parseDnConfig("{", "test"), Error);
  assertThrows(
    () => parseDnConfig('{"schema_version":"9.0"}', "test"),
    Error,
    "unsupported schema_version",
  );
});

Deno.test("Actions runs can omit the user layer", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-actions-" });
  try {
    const config = await resolveDnConfig({
      repoRoot: root,
      includeUser: false,
    });
    assertEquals(config.agent, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
