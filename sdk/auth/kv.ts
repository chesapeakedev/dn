// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * KV helper utilities for simplifying Deno KV operations in route handlers
 */

/**
 * Useful in route handlers to simplify kv operations
 */
export async function handleKvOperation<T>(
  kv: Deno.Kv,
  operation: "get" | "set" | "delete",
  key: string[],
  value?: T,
): Promise<Response> {
  try {
    let result;
    switch (operation) {
      case "get":
        result = await kv.get(key);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      case "set":
        if (value === undefined) {
          return new Response("Value is required for set operation", {
            status: 400,
          });
        }
        await kv.set(key, value);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      case "delete":
        await kv.delete(key);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : "An unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
