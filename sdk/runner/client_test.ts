// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { RunnerApiClient } from "./client.ts";
import { RUNNER_PROTOCOL_VERSION, type RunnerHeartbeat } from "./types.ts";

Deno.test("RunnerApiClient sends runner credentials only to authenticated endpoints", async () => {
  const requests: Request[] = [];
  const fakeFetch: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.endsWith("/api/runners/pairings")) {
      return Promise.resolve(Response.json({
        id: "pairing-1",
        approval_url: "https://denoise.example/approve",
        expires_at: "2026-07-23T12:05:00.000Z",
        poll_token: "poll-1",
      }));
    }
    if (request.url.endsWith("/api/runners/pairings/pairing-1/status")) {
      return Promise.resolve(Response.json({ state: "pending" }));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const client = new RunnerApiClient({
    apiUrl: "https://denoise.example",
    credential: "runner-secret",
    fetch: fakeFetch,
  });
  await client.startPairing("ABCD", {
    display_name: "Alex's MacBook",
    platform: "darwin",
    architecture: "aarch64",
    dn_version: "0.0.33",
    protocol_version: RUNNER_PROTOCOL_VERSION,
    capabilities: {
      operations: ["kickstart"],
      harnesses: ["codex"],
      docker: true,
    },
    repositories: ["chesapeakedev/dn"],
  });
  await client.getPairingStatus("pairing-1", "poll-secret");
  const heartbeat: RunnerHeartbeat = {
    protocol_version: RUNNER_PROTOCOL_VERSION,
    dn_version: "0.0.33",
    capabilities: {
      operations: ["kickstart"],
      harnesses: ["codex"],
      docker: true,
    },
    repositories: [{ repository: "chesapeakedev/dn", ready: true }],
    state: "ready",
  };
  await client.heartbeat(heartbeat);
  assertEquals(requests[0].headers.has("Authorization"), false);
  assertEquals(requests[1].url.includes("poll-secret"), false);
  assertEquals(await requests[1].clone().json(), {
    poll_token: "poll-secret",
  });
  assertEquals(
    requests[2].headers.get("Authorization"),
    "Bearer runner-secret",
  );
});

Deno.test("RunnerApiClient surfaces minimum protocol errors", async () => {
  const client = new RunnerApiClient({
    apiUrl: "https://denoise.example",
    credential: "runner-secret",
    fetch: () =>
      Promise.resolve(Response.json({
        message: "Unsupported runner protocol.",
        minimum_protocol_version: "2.0",
      }, { status: 426 })),
  });
  await assertRejects(
    () => client.status(),
    Error,
    "Unsupported runner protocol",
  );
});
