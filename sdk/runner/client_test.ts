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
    if (request.url.endsWith("/api/runners/heartbeat")) {
      return Promise.resolve(Response.json({
        pending_task_ops: [],
        list_tasks_requested: false,
      }));
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
      operations: ["kickstart", "denoise-task", "task-sync"],
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
      operations: ["kickstart", "denoise-task", "task-sync"],
      harnesses: ["codex"],
      docker: true,
    },
    repositories: [{ repository: "chesapeakedev/dn", ready: true }],
    state: "ready",
  };
  const heartbeatResponse = await client.heartbeat(heartbeat);
  assertEquals(heartbeatResponse, {
    pending_task_ops: [],
    list_tasks_requested: false,
  });
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

Deno.test("RunnerApiClient times out a hung request instead of stalling", async () => {
  const client = new RunnerApiClient({
    apiUrl: "https://denoise.example",
    credential: "runner-secret",
    requestTimeoutMs: 30,
    fetch: (input, init) => {
      const request = new Request(input, init);
      return new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(request.signal.reason ?? new Error("aborted"));
        });
      });
    },
  });
  await assertRejects(
    () => client.status(),
    Error,
    "Denoise runner API request timed out",
  );
});
