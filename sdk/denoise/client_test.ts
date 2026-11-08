// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { DenoiseApiError, denoiseApiRequest } from "./client.ts";

Deno.test("denoiseApiRequest surfaces API errors", async () => {
  await assertRejects(
    () =>
      denoiseApiRequest("POST", "/api/milestones", {
        githubToken: "x",
        apiUrl: "https://localhost",
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "nope" }), { status: 401 }),
          ),
      }),
    DenoiseApiError,
    "nope",
  );
  const ok = await denoiseApiRequest<{ milestones: unknown[] }>(
    "GET",
    "/api/milestones",
    {
      githubToken: "x",
      apiUrl: "https://localhost",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ milestones: [] }), { status: 200 }),
        ),
    },
  );
  assertEquals(ok.milestones, []);
});

Deno.test("denoiseApiRequest rejects untrusted api hosts", async () => {
  await assertRejects(
    () =>
      denoiseApiRequest("GET", "/api/milestones", {
        githubToken: "x",
        apiUrl: "https://evil.example",
      }),
    Error,
    "Untrusted Denoise API host",
  );
});
