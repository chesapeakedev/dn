// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  clearTokenCache,
  resolveGitHubTokenWithSource,
  type TokenResolverDeps,
} from "./token.ts";
import {
  DENOISE_GITHUB_APP_CLIENT_ID,
  resolveDeviceClientId,
} from "./deviceClientId.ts";

function deps(partial: Partial<TokenResolverDeps>): TokenResolverDeps {
  return {
    getEnv: () => undefined,
    readGhToken: () => Promise.resolve(null),
    readCachedToken: () => Promise.resolve(null),
    ...partial,
  };
}

Deno.test("resolveGitHubTokenWithSource prefers env over gh and dn", async () => {
  clearTokenCache();
  const result = await resolveGitHubTokenWithSource(deps({
    getEnv: (key) => key === "GITHUB_TOKEN" ? "env-token" : undefined,
    readGhToken: () => Promise.resolve("gh-token"),
    readCachedToken: () => Promise.resolve("dn-token"),
  }));
  assertEquals(result, { token: "env-token", source: "env" });
});

Deno.test("resolveGitHubTokenWithSource prefers gh over dn cache", async () => {
  clearTokenCache();
  const result = await resolveGitHubTokenWithSource(deps({
    readGhToken: () => Promise.resolve("gh-token"),
    readCachedToken: () => Promise.resolve("dn-token"),
  }));
  assertEquals(result, { token: "gh-token", source: "gh" });
});

Deno.test("resolveGitHubTokenWithSource uses dn cache when env and gh missing", async () => {
  clearTokenCache();
  const result = await resolveGitHubTokenWithSource(deps({
    readCachedToken: () => Promise.resolve("dn-token"),
  }));
  assertEquals(result, { token: "dn-token", source: "dn" });
});

Deno.test("resolveGitHubTokenWithSource accepts legacy DANGEROUS_GITHUB_TOKEN", async () => {
  clearTokenCache();
  const result = await resolveGitHubTokenWithSource(deps({
    getEnv: (key) =>
      key === "DANGEROUS_GITHUB_TOKEN" ? "legacy-token" : undefined,
  }));
  assertEquals(result, { token: "legacy-token", source: "env" });
});

Deno.test("resolveGitHubTokenWithSource throws when no sources available", async () => {
  clearTokenCache();
  await assertRejects(
    () => resolveGitHubTokenWithSource(deps({})),
    Error,
    "No GitHub token found",
  );
});

Deno.test("resolveDeviceClientId defaults to Denoise GitHub App", () => {
  assertEquals(
    resolveDeviceClientId(() => undefined),
    DENOISE_GITHUB_APP_CLIENT_ID,
  );
});

Deno.test("resolveDeviceClientId prefers DN_GITHUB_DEVICE_CLIENT_ID override", () => {
  assertEquals(
    resolveDeviceClientId((key) =>
      key === "DN_GITHUB_DEVICE_CLIENT_ID" ? "custom-id" : undefined
    ),
    "custom-id",
  );
});

Deno.test("resolveDeviceClientId accepts GITHUB_DEVICE_CLIENT_ID override", () => {
  assertEquals(
    resolveDeviceClientId((key) =>
      key === "GITHUB_DEVICE_CLIENT_ID" ? "alt-id" : undefined
    ),
    "alt-id",
  );
});
