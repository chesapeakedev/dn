// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { runDnCommand } from "./test_utils.ts";

Deno.test("workflows CLI installs and validates templates with JSON output", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-workflows-cli-" });
  try {
    const install = await runDnCommand(["workflows", "install", "--json"], {
      cwd: repoRoot,
    });
    const installJson = JSON.parse(install.stdout) as {
      results: Array<{ template: { id: string }; written: boolean }>;
    };
    assertEquals(installJson.results.length, 3);
    assertEquals(installJson.results.every((result) => result.written), true);

    const list = await runDnCommand(["workflows", "list", "--json"], {
      cwd: repoRoot,
    });
    const listJson = JSON.parse(list.stdout) as {
      templates: Array<{ status: string }>;
    };
    assertEquals(listJson.templates.map((status) => status.status), [
      "current",
      "current",
      "current",
    ]);

    const validate = await runDnCommand(["workflows", "validate", "--json"], {
      cwd: repoRoot,
    });
    const validateJson = JSON.parse(validate.stdout) as { ok: boolean };
    assertEquals(validateJson.ok, true);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("init workflows installs canonical templates", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-init-workflows-cli-" });
  try {
    const result = await runDnCommand(["init", "workflows", "--json"], {
      cwd: repoRoot,
    });
    const resultJson = JSON.parse(result.stdout) as {
      results: Array<{ template: { id: string } }>;
    };
    assertEquals(resultJson.results.length, 3);

    const config = JSON.parse(
      await Deno.readTextFile(`${repoRoot}/.github/dn/config.json`),
    ) as { agent: string };
    assertEquals(config.agent, "opencode");
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("init workflows --agent writes configured agent", async () => {
  const repoRoot = await Deno.makeTempDir({
    prefix: "dn-init-workflows-agent-",
  });
  try {
    await runDnCommand(["init", "workflows", "--agent", "claude", "--json"], {
      cwd: repoRoot,
    });
    const config = JSON.parse(
      await Deno.readTextFile(`${repoRoot}/.github/dn/config.json`),
    ) as { agent: string };
    assertEquals(config.agent, "claude");
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
