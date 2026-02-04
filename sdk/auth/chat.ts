// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/// <reference lib="deno.unstable" />
import { handleKvOperation } from "./kv.ts";

/**
 * Handles all /api/chat routes managing chat CRUD & server sent events (SSE)
 *
 * @param req - the request object
 * @param kv - Deno.Kv store for chat messages
 * @returns a response object
 */
export async function chatHandler(
  req: Request,
  kv: Deno.Kv,
): Promise<Response> {
  const url = new URL(req.url);
  const id = url.pathname.split("/").pop();
  const key = ["chat", id || "all"];

  // Handle real time updates using server side events
  if (url.pathname.endsWith("/watch")) {
    // Get the chat id from /api/chat/[id]/watch shaped url
    const chatId = url.pathname.split("/")[3];
    const watchKey = ["chat", chatId];

    // Web standards baby
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const watcher = kv.watch([watchKey]);

          for await (const [entry] of watcher) {
            try {
              if (entry?.value) {
                const data = JSON.stringify({ value: entry.value });
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              }
            } catch (error) {
              // If we can't enqueue, the stream is likely closed
              console.error(`Error enqueuing data for ${chatId}:`, error);
              console.log(
                `Client ${chatId} disconnected, cleaning up watch stream`,
              );
              break;
            }
          }
        } catch (error) {
          console.error(`Watch error for ${chatId}:`, error);
        } finally {
          try {
            controller.close();
          } catch (_e) {
            // Stream already closed, this is expected
            console.log(`Watch stream for ${chatId} already closed`);
          }
        }
      },
      cancel() {
        console.log(`Client disconnected from watch stream for ${chatId}`);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  if (req.method === "GET") {
    return handleKvOperation(kv, "get", key);
  }

  if (req.method === "POST") {
    const value = await req.json();
    return handleKvOperation(kv, "set", key, value);
  }

  if (req.method === "DELETE" && id) {
    return handleKvOperation(kv, "delete", key);
  }

  return new Response("Method not allowed", { status: 405 });
}
