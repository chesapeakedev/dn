// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { ObsidianClient } from "@chesapeake/obsidian-gql";
import type { AuthConfig, GitHubOAuthConfig, User as _User } from "./types.ts";
import { createSessionCookie, generateState, storeSession } from "./session.ts";
import { createOrGetUser } from "./user.ts";

// GitHub OAuth URLs
const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

const GET_VIEWER_QUERY = `
  query GetViewer {
    viewer {
      databaseId
      login
      avatarUrl
      name
      email
    }
  }
`;

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForGitHubToken(
  code: string,
  config: GitHubOAuthConfig,
): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Token exchange failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`GitHub error: ${data.error_description || data.error}`);
  }

  return data.access_token;
}

/**
 * Get user data from GitHub API using GraphQL
 * Returns raw GitHub user data (not our User type)
 */
export async function getGitHubUser(accessToken: string): Promise<{
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}> {
  const client = new ObsidianClient({
    endpoint: "https://api.github.com/graphql",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "dn-github-graphql",
    },
    useCache: false,
  });

  const result = await client.query(GET_VIEWER_QUERY, {
    cacheRead: false,
    cacheWrite: false,
  });

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors.map((e) => e.message ?? "Unknown error")
      .join("; ");
    throw new Error(`GitHub API error: ${errorMessages}`);
  }

  if (!result.data) {
    throw new Error("GitHub API error: No data returned");
  }

  const data = result.data as {
    viewer?: {
      databaseId: number;
      login: string;
      avatarUrl: string;
      name: string | null;
      email: string | null;
    };
  };

  if (!data.viewer) {
    throw new Error("GitHub API error: No viewer data returned");
  }

  // Convert GraphQL response to REST API format for compatibility
  return {
    id: data.viewer.databaseId,
    login: data.viewer.login,
    avatar_url: data.viewer.avatarUrl,
    name: data.viewer.name || undefined,
    email: data.viewer.email || undefined,
  };
}

/**
 * Handle GitHub OAuth initiation
 */
export async function handleGitHubAuth(
  _req: Request,
  kv: Deno.Kv,
  config: GitHubOAuthConfig,
  authConfig?: AuthConfig,
): Promise<Response> {
  if (!config.clientId) {
    return new Response(
      JSON.stringify({ error: "GitHub OAuth not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const state = generateState();
  const authUrl = new URL(GITHUB_AUTH_URL);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("scope", "user:email");
  authUrl.searchParams.set("state", state);

  // Store state in KV for validation
  const stateMaxAge = authConfig?.stateMaxAge || 600000; // 10 minutes default
  await kv.set(["oauth_state", state], {
    expiresAt: Date.now() + stateMaxAge,
  });

  return Response.redirect(authUrl.toString());
}

/**
 * Handle GitHub OAuth callback
 */
export async function handleGitHubCallback(
  req: Request,
  kv: Deno.Kv,
  config: GitHubOAuthConfig,
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
    const accessToken = await exchangeCodeForGitHubToken(code, config);

    // Get user data from GitHub
    const githubUser = await getGitHubUser(accessToken);

    // Create or get user with account linking (todo's pattern)
    const user = await createOrGetUser(
      kv,
      "github",
      String(githubUser.id),
      githubUser.avatar_url,
      githubUser.name,
      githubUser.email,
      githubUser.login,
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
