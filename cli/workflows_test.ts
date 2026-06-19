// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
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
    assertEquals(installJson.results.length, 4);
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
    assertEquals(resultJson.results.length, 4);

    const config = JSON.parse(
      await Deno.readTextFile(`${repoRoot}/.github/dn/config.json`),
    ) as { agent: string };
    assertEquals(config.agent, "opencode");
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("init build installs canonical workflow automation", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-init-build-cli-" });
  try {
    const result = await runDnCommand(["init", "build", "--json"], {
      cwd: repoRoot,
    });
    const resultJson = JSON.parse(result.stdout) as {
      results: Array<{ template: { id: string } }>;
    };
    assertEquals(
      resultJson.results.map((result) => result.template.id).includes(
        "dn.daily_kickstart",
      ),
      true,
    );
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

Deno.test("workflows run is rejected after dispatch rename", async () => {
  const result = await runDnCommand(["workflows", "run", "ci.yml"], {
    expectFailure: true,
  });
  assertStringIncludes(result.stderr, "Unknown workflows subcommand: run");
});

Deno.test("workflows exec --validate-only writes summary and outputs", async () => {
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-workflows-exec-" });
  try {
    await Deno.mkdir(`${repoRoot}/.github/dn`, { recursive: true });
    await Deno.writeTextFile(
      `${repoRoot}/.github/dn/config.json`,
      '{"schema_version":"1.0","agent":"opencode"}\n',
    );
    await Deno.writeTextFile(
      `${repoRoot}/event.json`,
      JSON.stringify({
        action: "dn.kickstart_issue",
        client_payload: {
          schema_version: "1.0",
          dispatch_id: "verify-1",
          issue_number: 42,
          validate_only: true,
        },
      }),
    );
    const summaryPath = `${repoRoot}/summary.md`;
    const outputPath = `${repoRoot}/output.txt`;
    await runDnCommand([
      "workflows",
      "exec",
      "dn.kickstart_issue",
      "--validate-only",
    ], {
      cwd: repoRoot,
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_WORKSPACE: repoRoot,
        GITHUB_EVENT_NAME: "repository_dispatch",
        GITHUB_EVENT_PATH: `${repoRoot}/event.json`,
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_OUTPUT: outputPath,
        OPENAI_API_KEY: "test-secret",
      },
    });
    assertStringIncludes(
      await Deno.readTextFile(summaryPath),
      "**Status:** validated",
    );
    assertStringIncludes(
      await Deno.readTextFile(outputPath),
      "phase=validation",
    );
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
