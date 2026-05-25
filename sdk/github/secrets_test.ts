// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { listRepositoryActionSecrets } from "./secrets.ts";

Deno.test("listRepositoryActionSecrets returns secret names", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (!url.includes("/actions/secrets")) {
      return originalFetch(input);
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          secrets: [
            { name: "OPENAI_API_KEY" },
            { name: "ANTHROPIC_API_KEY" },
          ],
          total_count: 2,
        }),
        { status: 200 },
      ),
    );
  };

  const previousToken = Deno.env.get("GITHUB_TOKEN");
  try {
    Deno.env.set("GITHUB_TOKEN", "test-token");
    const names = await listRepositoryActionSecrets("acme", "demo");
    assertEquals(names.has("OPENAI_API_KEY"), true);
    assertEquals(names.has("ANTHROPIC_API_KEY"), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) {
      Deno.env.delete("GITHUB_TOKEN");
    } else {
      Deno.env.set("GITHUB_TOKEN", previousToken);
    }
  }
});
