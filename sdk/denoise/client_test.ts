// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import { DenoiseApiError, denoiseApiRequest } from "./client.ts";

Deno.test("denoiseApiRequest surfaces API errors", async () => {
  await assertRejects(
    () =>
      denoiseApiRequest("POST", "/api/milestones", {
        githubToken: "x",
        apiUrl: "https://denoise.test",
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "nope" }), { status: 401 }),
          ),
      }),
    DenoiseApiError,
    "nope",
  );
  try {
    await denoiseApiRequest("GET", "/api/milestones", {
      githubToken: "x",
      apiUrl: "https://denoise.test",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ milestones: [] }), { status: 200 }),
        ),
    });
  } catch (e) {
    assertEquals(e, null);
  }
});
