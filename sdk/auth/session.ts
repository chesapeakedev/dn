// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AuthConfig, Session, User } from "./types.ts";

/**
 * Generate a secure random state parameter for OAuth
 */
export function generateState(): string {
  return crypto.randomUUID();
}

/**
 * Create a secure session cookie
 */
export function createSessionCookie(
  sessionId: string,
  config?: AuthConfig,
): string {
  const maxAge = config?.sessionMaxAge
    ? Math.floor(config.sessionMaxAge / 1000)
    : 7 * 24 * 60 * 60; // 7 days default
  return `session=${sessionId}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly; Secure`;
}

/**
 * Get session from cookie
 */
export async function getSessionFromCookie(
  cookie: string | null,
  kv: Deno.Kv,
): Promise<Session | null> {
  if (!cookie) return null;

  const sessionId = cookie
    .split(";")
    .find((c) => c.trim().startsWith("session="))
    ?.split("=")[1];

  if (!sessionId) return null;

  try {
    const result = await kv.get<Session>(["session", sessionId]);
    const session = result.value;

    if (!session || session.expiresAt < Date.now()) {
      // Session expired or doesn't exist
      await kv.delete(["session", sessionId]);
      return null;
    }

    return session;
  } catch (error) {
    console.error("Error getting session:", error);
    return null;
  }
}

/**
 * Store session in KV
 * Updated to match todo's pattern (string userId, no login field)
 */
export async function storeSession(
  sessionId: string,
  user: User,
  kv: Deno.Kv,
  config?: AuthConfig,
): Promise<void> {
  const expiresAt = config?.sessionMaxAge
    ? Date.now() + config.sessionMaxAge
    : Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days default

  const session: Session = {
    userId: user.id, // string UUID (todo's pattern)
    avatar_url: user.avatar_url,
    name: user.name,
    email: user.email,
    expiresAt,
  };

  await kv.set(["session", sessionId], session);
}

/**
 * Delete session from KV
 */
export async function deleteSession(
  sessionId: string,
  kv: Deno.Kv,
): Promise<void> {
  await kv.delete(["session", sessionId]);
}

/**
 * Extract session ID from cookie string
 */
export function extractSessionId(cookie: string | null): string | null {
  if (!cookie) return null;

  return cookie
    .split(";")
    .find((c) => c.trim().startsWith("session="))
    ?.split("=")[1] || null;
}
