// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  type CursorCloudSdk,
  startCursorCloudAgent,
} from "./cursorCloudAgent.ts";

Deno.test("startCursorCloudAgent configures the SDK cloud repository", async () => {
  let receivedPrompt = "";
  let receivedOptions: Parameters<CursorCloudSdk["create"]>[0] | undefined;
  const sdk: CursorCloudSdk = {
    create: (options) => {
      receivedOptions = options;
      return Promise.resolve({
        send: (prompt) => {
          receivedPrompt = prompt;
          return Promise.resolve({ id: "run-123", agentId: "agent-456" });
        },
      });
    },
  };

  const result = await startCursorCloudAgent({
    apiKey: "test-key",
    prompt: "Implement issue #12",
    repository: {
      url: "https://github.com/example/widgets.git",
      startingRef: "main",
    },
    autoCreatePr: true,
  }, sdk);

  assertEquals(result, { runId: "run-123", agentId: "agent-456" });
  assertEquals(receivedPrompt, "Implement issue #12");
  assertEquals(receivedOptions, {
    apiKey: "test-key",
    model: { id: "auto" },
    cloud: {
      repos: [{
        url: "https://github.com/example/widgets.git",
        startingRef: "main",
      }],
      autoCreatePR: true,
    },
  });
});

Deno.test("startCursorCloudAgent requires an API key before creating an agent", async () => {
  const previous = Deno.env.get("CURSOR_API_KEY");
  Deno.env.delete("CURSOR_API_KEY");
  try {
    await assertRejects(
      () =>
        startCursorCloudAgent({
          prompt: "Implement issue #12",
          repository: {
            url: "https://github.com/example/widgets.git",
            startingRef: "main",
          },
          autoCreatePr: false,
        }, {
          create: () => Promise.reject(new Error("SDK must not be called")),
        }),
      Error,
      "CURSOR_API_KEY is required",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("CURSOR_API_KEY");
    else Deno.env.set("CURSOR_API_KEY", previous);
  }
});
