// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_SANDBOX_CONFIG,
  parseDnSandboxConfig,
  parseSandboxProvider,
} from "./config.ts";

Deno.test("parseSandboxProvider accepts known providers", () => {
  assertEquals(parseSandboxProvider("none"), "none");
  assertEquals(parseSandboxProvider("docker"), "docker");
  assertEquals(parseSandboxProvider("exe.dev"), "exe.dev");
});

Deno.test("parseSandboxProvider rejects unknown providers", () => {
  assertThrows(
    () => parseSandboxProvider("fly"),
    Error,
    "Invalid sandbox provider",
  );
});

Deno.test("parseDnSandboxConfig applies defaults", () => {
  const config = parseDnSandboxConfig(undefined);
  assertEquals(config.provider, "none");
  assertEquals(config.workspace, DEFAULT_SANDBOX_CONFIG.workspace);
  assertEquals(config.docker.image, DEFAULT_SANDBOX_CONFIG.docker.image);
});

Deno.test("parseDnSandboxConfig parses issue #338 example fields", () => {
  const config = parseDnSandboxConfig({
    provider: "docker",
    workspace: "/workspace",
    sync: { mode: "bind", exclude: [".git"] },
    docker: {
      image: "denoland/deno",
      network: "bridge",
      read_only_root: false,
      mounts: [{ source: ".", target: "/workspace" }],
      env_pass_through: ["OPENAI_API_KEY"],
    },
    exe_dev: {
      image: "exeuntu",
      vm_name_prefix: "dn-kickstart",
      ttl: "4h",
      integrations: ["github"],
    },
  });
  assertEquals(config.provider, "docker");
  assertEquals(config.docker.network, "bridge");
  assertEquals(config.docker.read_only_root, false);
  assertEquals(config.sync.exclude, [".git"]);
  assertEquals(config.docker.dockerfile, undefined);
});

Deno.test("parseDnSandboxConfig accepts optional dockerfile path", () => {
  const config = parseDnSandboxConfig({
    provider: "docker",
    docker: {
      image: "ghcr.io/example/project:sha-abc123",
      dockerfile: "docker/Dockerfile",
    },
  });
  assertEquals(config.docker.image, "ghcr.io/example/project:sha-abc123");
  assertEquals(config.docker.dockerfile, "docker/Dockerfile");
});

Deno.test("parseDnSandboxConfig rejects empty dockerfile", () => {
  assertThrows(
    () =>
      parseDnSandboxConfig({
        docker: { dockerfile: "   " },
      }),
    Error,
    "sandbox.docker.dockerfile must be a non-empty string path",
  );
});

Deno.test("parseDnWorkflowAgentConfig accepts schema 1.1 with sandbox", async () => {
  const { parseDnWorkflowAgentConfig } = await import(
    "../workflows/agentConfig.ts"
  );
  const config = parseDnWorkflowAgentConfig(
    JSON.stringify({
      schema_version: "1.1",
      agent: "opencode",
      sandbox: { provider: "docker" },
    }),
  );
  assertEquals(config.schema_version, "1.1");
  assertEquals(config.sandbox?.provider, "docker");
});

Deno.test("parseDnWorkflowAgentConfig keeps 1.0 configs agent-only", async () => {
  const { parseDnWorkflowAgentConfig } = await import(
    "../workflows/agentConfig.ts"
  );
  const config = parseDnWorkflowAgentConfig(
    JSON.stringify({ schema_version: "1.0", agent: "cursor" }),
  );
  assertEquals(config.schema_version, "1.0");
  assertEquals(config.sandbox, undefined);
});
