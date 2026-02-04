// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { AuthConfig, GoogleOAuthConfig, User as _User } from "./types.ts";
import { createSessionCookie, generateState, storeSession } from "./session.ts";
import { createOrGetUser } from "./user.ts";

// Google OAuth URLs
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USER_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * Exchange Google authorization code for access token
 */
export async function exchangeCodeForGoogleToken(
  code: string,
  config: GoogleOAuthConfig,
): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Token exchange failed: ${
        error.error_description || error.error || response.statusText
      }`,
    );
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Google error: ${data.error_description || data.error}`);
  }

  if (!data.access_token) {
    throw new Error("No access token received from Google");
  }

  return data.access_token;
}

/**
 * Get user data from Google API
 * Returns raw Google user data (not our User type)
 */
export async function getGoogleUser(accessToken: string): Promise<{
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}> {
  const response = await fetch(GOOGLE_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error_description ||
        error.error ||
        `Google API error: ${response.status} ${response.statusText}`,
    );
  }

  return await response.json();
}

/**
 * Handle Google OAuth initiation
 */
export async function handleGoogleAuth(
  _req: Request,
  kv: Deno.Kv,
  config: GoogleOAuthConfig,
  authConfig?: AuthConfig,
): Promise<Response> {
  if (!config.clientId) {
    return new Response(
      JSON.stringify({ error: "Google OAuth not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const state = generateState();
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  // Store state in KV for validation
  const stateMaxAge = authConfig?.stateMaxAge || 600000; // 10 minutes default
  await kv.set(["oauth_state", state], {
    expiresAt: Date.now() + stateMaxAge,
  });

  return Response.redirect(authUrl.toString());
}

/**
 * Handle Google OAuth callback
 */
export async function handleGoogleCallback(
  req: Request,
  kv: Deno.Kv,
  config: GoogleOAuthConfig,
  authConfig?: AuthConfig,
): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response("Missing authorization code or state", {
      status: 400,
    });
  }

  try {
    // Verify state parameter
    const stateResult = await kv.get<{ expiresAt: number }>([
      "oauth_state",
      state,
    ]);
    if (!stateResult.value) {
      return new Response("Invalid state parameter", { status: 400 });
    }

    // Check if state expired
    if (stateResult.value.expiresAt < Date.now()) {
      await kv.delete(["oauth_state", state]);
      return new Response("State parameter expired", { status: 400 });
    }

    // Clean up state
    await kv.delete(["oauth_state", state]);

    // Exchange code for token
    const accessToken = await exchangeCodeForGoogleToken(code, config);

    // Get user data from Google
    const googleUser = await getGoogleUser(accessToken);

    // Create or get user with account linking (todo's pattern)
    const user = await createOrGetUser(
      kv,
      "google",
      googleUser.sub,
      googleUser.picture || "",
      googleUser.name,
      googleUser.email,
    );

    // Create session
    const sessionId = crypto.randomUUID();
    await storeSession(sessionId, user, kv, authConfig);

    // Redirect to frontend with success
    const frontendUrl = new URL("/", req.url);
    return new Response(null, {
      status: 302,
      headers: {
        Location: frontendUrl.toString(),
        "Set-Cookie": createSessionCookie(sessionId, authConfig),
      },
    });
  } catch (error) {
    console.error("OAuth callback error:", error);
    return new Response(
      `Authentication failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { status: 500 },
    );
  }
}
