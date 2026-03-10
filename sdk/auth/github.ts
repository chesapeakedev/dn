// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { ObsidianClient } from "@chesapeake/obsidian-gql";
import type {
  AuthConfig,
  GitHubCallbackResult,
  GitHubOAuthConfig,
  OAuthState,
  User as _User,
} from "./types.ts";
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
 * Handle GitHub OAuth initiation.
 *
 * When {@linkcode GitHubOAuthConfig.appSlug} is set the user is first sent
 * through the GitHub App installation page so they can install the app on an
 * org (or personal account). After installation GitHub redirects to the
 * **Setup URL** which must point to {@linkcode handleGitHubSetup}.
 *
 * Pass `?flow=oauth_only` on the incoming request to skip the installation
 * step and go straight to `login/oauth/authorize`.
 */
export async function handleGitHubAuth(
  req: Request,
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
  const stateMaxAge = authConfig?.stateMaxAge || 600000; // 10 minutes default
  const stateData: OAuthState = { expiresAt: Date.now() + stateMaxAge };
  await kv.set(["oauth_state", state], stateData);

  const reqUrl = new URL(req.url);
  const flowOverride = reqUrl.searchParams.get("flow");
  const useInstallFlow = config.appSlug && flowOverride !== "oauth_only";

  if (useInstallFlow) {
    const installUrl = new URL(
      `https://github.com/apps/${config.appSlug}/installations/new`,
    );
    installUrl.searchParams.set("state", state);
    return Response.redirect(installUrl.toString());
  }

  const authUrl = buildOAuthAuthorizeUrl(config, state);
  return Response.redirect(authUrl);
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

// ---------------------------------------------------------------------------
// Setup route (GitHub App installation redirect target)
// ---------------------------------------------------------------------------

/**
 * Handle the GitHub App **Setup URL** redirect.
 *
 * After a user installs (or updates) the GitHub App, GitHub redirects here
 * with `state`, `installation_id`, and `setup_action` query parameters.
 *
 * The handler validates the `state` token, optionally stores the
 * `installation_id` alongside it, then redirects the user to the standard
 * OAuth authorize URL so they can complete sign-in.
 *
 * **Important**: The GitHub App's *Setup URL* setting must point to the route
 * that calls this handler (e.g. `https://example.com/api/auth/github/setup`).
 */
export async function handleGitHubSetup(
  req: Request,
  kv: Deno.Kv,
  config: GitHubOAuthConfig,
): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const installationId = url.searchParams.get("installation_id");

  if (!state) {
    return new Response(
      JSON.stringify({ error: "Missing state parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const stateResult = await kv.get<OAuthState>(["oauth_state", state]);
  if (!stateResult.value) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired state parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (stateResult.value.expiresAt < Date.now()) {
    await kv.delete(["oauth_state", state]);
    return new Response(
      JSON.stringify({ error: "State parameter expired" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Persist the installation_id alongside the state for later use.
  // Do NOT delete the state entry — the callback will clean it up after
  // the code exchange succeeds.
  if (installationId) {
    await kv.set(["oauth_state", state], {
      ...stateResult.value,
      installationId,
    });
  }

  const authUrl = buildOAuthAuthorizeUrl(config, state);
  return Response.redirect(authUrl);
}

// ---------------------------------------------------------------------------
// Auth initiation helper
// ---------------------------------------------------------------------------

/**
 * Options for {@linkcode initiateGitHubAuth}.
 */
export interface InitiateGitHubAuthOptions {
  /**
   * When `true`, skip the App installation step and redirect directly to
   * the OAuth authorize URL even when `appSlug` is configured.
   */
  oauthOnly?: boolean;
}

/**
 * Generate an OAuth state token, store it in KV, and return the redirect URL.
 *
 * This is a lower-level helper for consumers who need the URL without the
 * full HTTP handler (e.g. for server-rendered pages that build their own
 * redirect).
 *
 * @returns The URL to redirect the user to.
 */
export async function initiateGitHubAuth(
  kv: Deno.Kv,
  config: GitHubOAuthConfig,
  authConfig?: AuthConfig,
  options?: InitiateGitHubAuthOptions,
): Promise<{ url: string; state: string }> {
  const state = generateState();
  const stateMaxAge = authConfig?.stateMaxAge || 600000;
  const stateData: OAuthState = { expiresAt: Date.now() + stateMaxAge };
  await kv.set(["oauth_state", state], stateData);

  const useInstallFlow = config.appSlug && !options?.oauthOnly;

  if (useInstallFlow) {
    const installUrl = new URL(
      `https://github.com/apps/${config.appSlug}/installations/new`,
    );
    installUrl.searchParams.set("state", state);
    return { url: installUrl.toString(), state };
  }

  return { url: buildOAuthAuthorizeUrl(config, state), state };
}

// ---------------------------------------------------------------------------
// Callback helper
// ---------------------------------------------------------------------------

/**
 * Validate state, exchange the authorization code for a token, and resolve
 * the GitHub user — without creating a session.
 *
 * Consumers can call this from their own callback route and then handle
 * session creation (or any other post-auth logic) themselves.
 *
 * @throws {Error} If the state is invalid/expired or the code exchange fails.
 */
export async function validateGitHubCallback(
  code: string,
  state: string,
  kv: Deno.Kv,
  config: GitHubOAuthConfig,
): Promise<GitHubCallbackResult> {
  const stateResult = await kv.get<OAuthState>(["oauth_state", state]);
  if (!stateResult.value) {
    throw new Error("Invalid state parameter");
  }
  if (stateResult.value.expiresAt < Date.now()) {
    await kv.delete(["oauth_state", state]);
    throw new Error("State parameter expired");
  }

  await kv.delete(["oauth_state", state]);

  const accessToken = await exchangeCodeForGitHubToken(code, config);
  const githubUser = await getGitHubUser(accessToken);

  const user = await createOrGetUser(
    kv,
    "github",
    String(githubUser.id),
    githubUser.avatar_url,
    githubUser.name,
    githubUser.email,
    githubUser.login,
  );

  return { user, accessToken };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the standard `login/oauth/authorize` URL with the given state. */
function buildOAuthAuthorizeUrl(
  config: GitHubOAuthConfig,
  state: string,
): string {
  const authUrl = new URL(GITHUB_AUTH_URL);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("scope", "user:email");
  authUrl.searchParams.set("state", state);
  return authUrl.toString();
}
