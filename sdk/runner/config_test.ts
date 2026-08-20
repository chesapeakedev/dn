// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  getRunnerConfigPaths,
  loadRunnerConfig,
  loadRunnerCredential,
  registerRunnerRepository,
  RUNNER_CONFIG_SCHEMA_VERSION,
  saveRunnerCredential,
} from "./mod.ts";

Deno.test("runner credential and config files use user-only permissions", async () => {
  const directory = await Deno.makeTempDir({ prefix: "dn-runner-config-" });
  const paths = getRunnerConfigPaths(directory);
  try {
    await saveRunnerCredential({
      schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
      runner_id: "runner-1",
      owner_id: "owner-1",
      display_name: "Alex's MacBook",
      api_url: "https://denoise.example",
      credential: "runner-secret",
      created_at: "2026-07-23T12:00:00.000Z",
      expires_at: "2027-07-23T12:00:00.000Z",
    }, paths);
    assertEquals(await loadRunnerCredential(paths), {
      schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
      runner_id: "runner-1",
      owner_id: "owner-1",
      display_name: "Alex's MacBook",
      api_url: "https://denoise.example",
      credential: "runner-secret",
      created_at: "2026-07-23T12:00:00.000Z",
      expires_at: "2027-07-23T12:00:00.000Z",
    });
    if (Deno.build.os !== "windows") {
      assertEquals((await Deno.stat(paths.credential)).mode! & 0o777, 0o600);
      assertEquals((await Deno.stat(paths.directory)).mode! & 0o777, 0o700);
    }

    const checkout = await Deno.makeTempDir({ prefix: "dn-runner-repo-" });
    try {
      await registerRunnerRepository(
        "chesapeakedev/dn",
        checkout,
        paths,
      );
      const config = await loadRunnerConfig(paths);
      assertEquals(
        config.repositories["chesapeakedev/dn"].path,
        checkout,
      );
      if (Deno.build.os !== "windows") {
        assertEquals((await Deno.stat(paths.config)).mode! & 0o777, 0o600);
      }
    } finally {
      await Deno.remove(checkout, { recursive: true });
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
