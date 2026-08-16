// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  extractAgentFlag,
  formatDnWorkflowAgentConfig,
  installWorkflowSupport,
  parseDnWorkflowAgentConfig,
  readDnWorkflowAgentConfig,
  removeLegacyInstallScript,
  requiredSecretForAgent,
  resolveRepoFromRoot,
} from "./agentConfig.ts";

Deno.test("parseDnWorkflowAgentConfig accepts valid agent", () => {
  const config = parseDnWorkflowAgentConfig(
    formatDnWorkflowAgentConfig("claude"),
  );
  assertEquals(config.agent, "claude");
});

Deno.test("removeLegacyInstallScript removes canonical and preserves modified files", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-agent-migration-" });
  try {
    await Deno.mkdir(`${repoRoot}/.github/dn`, { recursive: true });
    const canonical = await Deno.readTextFile(
      new URL("../../templates/workflows/install-agent.sh", import.meta.url),
    );
    const path = `${repoRoot}/.github/dn/install-agent.sh`;
    await Deno.writeTextFile(path, canonical);
    assertEquals(await removeLegacyInstallScript(repoRoot), "removed");

    await Deno.writeTextFile(path, `${canonical}\n# customized\n`);
    assertEquals(await removeLegacyInstallScript(repoRoot), "modified");
    assertEquals((await Deno.stat(path)).isFile, true);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("parseDnWorkflowAgentConfig rejects invalid agent", () => {
  assertThrows(
    () => {
      parseDnWorkflowAgentConfig(
        JSON.stringify({ schema_version: "1.0", agent: "gpt" }),
      );
    },
    Error,
    "Invalid agent",
  );
});

Deno.test("extractAgentFlag parses and removes --agent", () => {
  const parsed = extractAgentFlag(["install", "--agent", "cursor", "--json"]);
  assertEquals(parsed.agent, "cursor");
  assertEquals(parsed.rest, ["install", "--json"]);
});

Deno.test("requiredSecretForAgent maps harness to secret name", () => {
  assertEquals(requiredSecretForAgent("claude"), "ANTHROPIC_API_KEY");
  assertEquals(requiredSecretForAgent("cursor"), "CURSOR_API_KEY");
  assertEquals(requiredSecretForAgent("opencode"), "OPENAI_API_KEY");
  assertEquals(requiredSecretForAgent("codex"), "OPENAI_API_KEY");
  assertEquals(requiredSecretForAgent("copilot"), "COPILOT_GITHUB_TOKEN");
});

Deno.test("installWorkflowSupport writes config when agent is provided", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-agent-config-" });
  try {
    const results = await installWorkflowSupport(repoRoot, {
      agent: "claude",
    });
    assertEquals(results.length, 1);
    const config = await readDnWorkflowAgentConfig(repoRoot);
    assertEquals(config?.agent, "claude");
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("resolveRepoFromRoot returns null without VCS metadata", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-repo-none-" });
  try {
    assertEquals(await resolveRepoFromRoot(repoRoot), null);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test(
  "resolveRepoFromRoot ignores missing remotes in Sapling-only checkouts",
  async () => {
    const repoRoot = await Deno.makeTempDir({ prefix: "dn-repo-sl-" });
    try {
      await Deno.mkdir(join(repoRoot, ".sl"));
      // No .git → must not probe git; empty .sl → sapling remote read fails quietly.
      assertEquals(await resolveRepoFromRoot(repoRoot), null);
    } finally {
      await Deno.remove(repoRoot, { recursive: true });
    }
  },
);

Deno.test("resolveRepoFromRoot reads Git origin when .git is present", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-repo-git-" });
  try {
    const init = await new Deno.Command("git", {
      args: ["init"],
      cwd: repoRoot,
      stdout: "null",
      stderr: "null",
    }).output();
    assertEquals(init.code, 0);
    const remote = await new Deno.Command("git", {
      args: ["remote", "add", "origin", "https://github.com/acme/widgets.git"],
      cwd: repoRoot,
      stdout: "null",
      stderr: "null",
    }).output();
    assertEquals(remote.code, 0);
    assertEquals(await resolveRepoFromRoot(repoRoot), {
      owner: "acme",
      repo: "widgets",
    });
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
