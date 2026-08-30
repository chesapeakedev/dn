// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  bootstrapRunnerCredentialFromEnv,
  cloudRunnerEnabled,
  runnerCredentialFromEnv,
} from "./bootstrap.ts";
import {
  getRunnerConfigPaths,
  RUNNER_CONFIG_SCHEMA_VERSION,
  saveRunnerCredential,
} from "./config.ts";

Deno.test("cloudRunnerEnabled is true for exe.dev provider", () => {
  assertEquals(cloudRunnerEnabled({ DN_RUNNER_PROVIDER: "exe.dev" }), true);
  assertEquals(cloudRunnerEnabled({ DN_RUNNER_CLOUD: "1" }), true);
  assertEquals(cloudRunnerEnabled({}), false);
});

Deno.test("runnerCredentialFromEnv requires id, credential, and API URL", () => {
  assertEquals(runnerCredentialFromEnv({}), null);
  const parsed = runnerCredentialFromEnv({
    DN_RUNNER_CREDENTIAL: "runner-1.secret",
    DN_RUNNER_API_URL: "https://denoise.example",
    DN_RUNNER_ID: "runner-1",
    DN_RUNNER_DISPLAY_NAME: "exe.dev",
    DN_RUNNER_OWNER_ID: "owner-1",
    DN_RUNNER_EXPIRES_AT: "2027-01-01T00:00:00.000Z",
  });
  assertEquals(parsed?.runner_id, "runner-1");
  assertEquals(parsed?.credential, "runner-1.secret");
  assertEquals(parsed?.api_url, "https://denoise.example");
  assertEquals(parsed?.owner_id, "owner-1");
});

Deno.test("bootstrapRunnerCredentialFromEnv writes once and keeps rotated files", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-bootstrap-" });
  const paths = getRunnerConfigPaths(directory);
  const env = {
    DN_RUNNER_CREDENTIAL: "runner-1.env-secret",
    DN_RUNNER_API_URL: "https://denoise.example",
    DN_RUNNER_ID: "runner-1",
    DN_RUNNER_DISPLAY_NAME: "exe.dev",
    DN_RUNNER_EXPIRES_AT: "2027-01-01T00:00:00.000Z",
  };
  try {
    const first = await bootstrapRunnerCredentialFromEnv(env, paths);
    assertEquals(first?.credential, "runner-1.env-secret");
    await saveRunnerCredential({
      schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
      runner_id: "runner-1",
      display_name: "exe.dev",
      api_url: "https://denoise.example",
      credential: "runner-1.rotated",
      created_at: "2026-08-30T00:00:00.000Z",
      expires_at: "2027-01-01T00:00:00.000Z",
    }, paths);
    const second = await bootstrapRunnerCredentialFromEnv({
      ...env,
      DN_RUNNER_CREDENTIAL: "runner-1.stale-env",
    }, paths);
    assertEquals(second?.credential, "runner-1.rotated");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
