// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  toActionsProjectionDocument,
  toDnActionsConfig,
  writeActionsConfigProjection,
} from "./actions.ts";
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
      repositorySlug: "test/repo",
      env: { DN_AGENT: "codex" },
      cli: { agent: "copilot" },
    });
    assertEquals(config.agent, "copilot");
    assertEquals(config.sources.agent, "cli");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolveDnConfig prefers dn.json over legacy Actions config", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-config-legacy-" });
  try {
    await Deno.mkdir(join(root, ".github/dn"), { recursive: true });
    await Deno.writeTextFile(
      join(root, ".github/dn/config.json"),
      JSON.stringify({ schema_version: "1.0", agent: "claude" }),
    );
    await Deno.writeTextFile(
      join(root, "dn.json"),
      JSON.stringify({ schema_version: "2.0", agent: "cursor" }),
    );
    const config = await resolveDnConfig({
      repoRoot: root,
      includeUser: false,
      env: {},
    });
    assertEquals(config.agent, "cursor");
    assertEquals(config.sources.agent, "repository");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolveDnConfig falls back to legacy Actions config", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-config-fallback-" });
  try {
    await Deno.mkdir(join(root, ".github/dn"), { recursive: true });
    await Deno.writeTextFile(
      join(root, ".github/dn/config.json"),
      JSON.stringify({ schema_version: "1.0", agent: "codex" }),
    );
    const config = await resolveDnConfig({
      repoRoot: root,
      includeUser: false,
      env: {},
    });
    assertEquals(config.agent, "codex");
    assertEquals(config.sources.agent, "repository");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolveDnConfig merges user defaults and repos overrides", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-config-user-" });
  const user = `${root}/user.json`;
  try {
    await Deno.writeTextFile(
      user,
      JSON.stringify({
        defaults: { agent: "claude" },
        repos: {
          "acme/widgets": { agent: "cursor" },
          "acme/other": { agent: "codex" },
        },
      }),
    );
    const forWidgets = await resolveDnConfig({
      repoRoot: root,
      userConfigPath: user,
      repositorySlug: "acme/widgets",
      env: {},
    });
    assertEquals(forWidgets.agent, "cursor");
    assertEquals(forWidgets.sources.agent, "user");

    const forOther = await resolveDnConfig({
      repoRoot: root,
      userConfigPath: user,
      repositorySlug: "acme/other",
      env: {},
    });
    assertEquals(forOther.agent, "codex");

    const unknown = await resolveDnConfig({
      repoRoot: root,
      userConfigPath: user,
      repositorySlug: "acme/unknown",
      env: {},
    });
    assertEquals(unknown.agent, "claude");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Actions runs can omit the user layer", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-actions-" });
  const user = `${root}/user.json`;
  try {
    await Deno.writeTextFile(
      user,
      JSON.stringify({ defaults: { agent: "claude" } }),
    );
    const config = await resolveDnConfig({
      repoRoot: root,
      userConfigPath: user,
      includeUser: false,
      env: {},
    });
    assertEquals(config.agent, undefined);
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

Deno.test("parseDnConfig accepts rfc and strict project blocks", () => {
  const parsed = parseDnConfig(
    JSON.stringify({
      schema_version: "2.0",
      agent: "opencode",
      rfc: { dir: "design/rfcs" },
      strict: { enabled: false, require_rfcs: true },
    }),
    "test",
  );
  assertEquals(parsed.rfc, { dir: "design/rfcs" });
  assertEquals(parsed.strict, { enabled: false, require_rfcs: true });
});

Deno.test("writeActionsConfigProjection emits bridge from dn.json", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-projection-" });
  try {
    await Deno.writeTextFile(
      join(root, "dn.json"),
      JSON.stringify({
        schema_version: "2.0",
        agent: "claude",
        sandbox: { provider: "docker" },
      }),
    );
    const result = await writeActionsConfigProjection(root);
    assertEquals(result.written, true);
    assertEquals(result.skipped, false);
    const written = JSON.parse(
      await Deno.readTextFile(join(root, ".github/dn/config.json")),
    );
    assertEquals(written.schema_version, "1.1");
    assertEquals(written.agent, "claude");
    assertEquals(written.sandbox.provider, "docker");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("writeActionsConfigProjection skips when dn.json is absent", async () => {
  const root = await Deno.makeTempDir({ prefix: "dn-projection-skip-" });
  try {
    const result = await writeActionsConfigProjection(root);
    assertEquals(result.skipped, true);
    assertEquals(result.written, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("toActionsProjectionDocument requires an agent", () => {
  assertEquals(toActionsProjectionDocument({}), null);
  assertEquals(
    toActionsProjectionDocument({ agent: "opencode" }),
    { schema_version: "1.0", agent: "opencode" },
  );
});
