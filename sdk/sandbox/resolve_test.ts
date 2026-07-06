// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { extractSandboxFlag, resolveSandboxFlagValue } from "./cli.ts";
import { resolveSandboxProvider } from "./resolve.ts";

Deno.test("extractSandboxFlag parses --sandbox docker", () => {
  const parsed = extractSandboxFlag(["kickstart", "--sandbox", "docker", "1"]);
  assertEquals(parsed.sandbox, "docker");
  assertEquals(parsed.rest, ["kickstart", "1"]);
});

Deno.test("extractSandboxFlag treats bare --sandbox as from-config", () => {
  const parsed = extractSandboxFlag(["loop", "--sandbox"]);
  assertEquals(parsed.sandbox, "from-config");
  assertEquals(parsed.rest, ["loop"]);
});

Deno.test("extractSandboxFlag parses kickstart-style args", () => {
  const parsed = extractSandboxFlag(["--sandbox", "docker", "42"]);
  assertEquals(parsed.sandbox, "docker");
  assertEquals(parsed.rest, ["42"]);
});

Deno.test("resolveSandboxFlagValue prefers subcommand flag over global", () => {
  assertEquals(
    resolveSandboxFlagValue("none", "docker"),
    "docker",
  );
});

Deno.test("resolveSandboxProvider honors CLI none override", () => {
  assertEquals(
    resolveSandboxProvider({
      cliFlag: "none",
      configProvider: "docker",
    }),
    "none",
  );
});

Deno.test("resolveSandboxProvider reads config when --sandbox has no value", () => {
  assertEquals(
    resolveSandboxProvider({
      cliFlag: "from-config",
      configProvider: "exe.dev",
    }),
    "exe.dev",
  );
});

Deno.test("resolveSandboxProvider errors when from-config and config missing", () => {
  assertThrows(
    () =>
      resolveSandboxProvider({
        cliFlag: "from-config",
        configProvider: null,
      }),
    Error,
    "sandbox.provider",
  );
});

Deno.test("resolveSandboxConfig merges repo config with CLI override", async () => {
  const { resolveSandboxConfig } = await import("./resolve.ts");
  const repoRoot = await Deno.makeTempDir({ prefix: "dn-sandbox-resolve-" });
  try {
    await Deno.mkdir(join(repoRoot, ".github/dn"), { recursive: true });
    await Deno.writeTextFile(
      join(repoRoot, ".github/dn/config.json"),
      JSON.stringify({
        schema_version: "1.1",
        agent: "opencode",
        sandbox: { provider: "docker" },
      }),
    );
    const resolved = await resolveSandboxConfig(repoRoot, "none");
    assertEquals(resolved.provider, "none");
    assertEquals(resolved.config.provider, "none");
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
