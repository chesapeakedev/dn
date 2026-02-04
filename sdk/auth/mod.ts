// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * @dn/sdk/auth - Authentication utilities for OAuth and session management
 *
 * This module provides OAuth authentication handlers for GitHub and Google,
 * session management using Deno KV, and user management utilities.
 */

// Types
export type {
  AuthConfig,
  ChatMessage,
  GitHubOAuthConfig,
  GoogleOAuthConfig,
  OAuthProvider,
  OAuthState,
  Session,
  User,
  UserInfo,
} from "./types.ts";

// Session management
// Internal: session primitives are not part of the stable SDK contract

// GitHub OAuth
// Internal: exposed via AuthHandler only

// Google OAuth
// Internal: exposed via AuthHandler only

// User management
// Internal: HTTP handlers are not part of the public SDK

// Chat
// Internal

// KV utilities
// Internal

import type { AuthConfig } from "./types.ts";
import { handleGitHubAuth, handleGitHubCallback } from "./github.ts";
import { handleGoogleAuth, handleGoogleCallback } from "./google.ts";
import { handleGetUser, handleLogout } from "./user.ts";

/**
 * Auth handler providing stable OAuth and session-backed endpoints.
 *
 * This class is the primary public entrypoint for authentication.
 * Method behavior and request/response shapes are stable across minor versions.
 */
export class AuthHandler {
  constructor(
    private kv: Deno.Kv,
    private config: AuthConfig,
  ) {}

  /**
   * Initiates the GitHub OAuth flow.
   *
   * Guarantees:
   * - Returns an HTTP redirect response on success.
   * - Returns a JSON error response if GitHub OAuth is not configured.
   */
  handleGitHubAuth(req: Request): Promise<Response> {
    if (!this.config.github) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "GitHub OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return handleGitHubAuth(req, this.kv, this.config.github, this.config);
  }

  /**
   * Handles the GitHub OAuth callback.
   *
   * Guarantees:
   * - Establishes a user session on success.
   * - Returns a JSON error response if GitHub OAuth is not configured or fails.
   */
  handleGitHubCallback(req: Request): Promise<Response> {
    if (!this.config.github) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "GitHub OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return handleGitHubCallback(req, this.kv, this.config.github, this.config);
  }

  /**
   * Initiates the Google OAuth flow.
   *
   * Guarantees:
   * - Returns an HTTP redirect response on success.
   * - Returns a JSON error response if Google OAuth is not configured.
   */
  handleGoogleAuth(req: Request): Promise<Response> {
    if (!this.config.google) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Google OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return handleGoogleAuth(req, this.kv, this.config.google, this.config);
  }

  /**
   * Handles the Google OAuth callback.
   *
   * Guarantees:
   * - Establishes a user session on success.
   * - Returns a JSON error response if Google OAuth is not configured or fails.
   */
  handleGoogleCallback(req: Request): Promise<Response> {
    if (!this.config.google) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Google OAuth not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return handleGoogleCallback(req, this.kv, this.config.google, this.config);
  }

  /**
   * Returns the currently authenticated user.
   *
   * Guarantees:
   * - Returns user information when a valid session exists.
   * - Returns an unauthenticated response when no session is present.
   */
  handleGetUser(req: Request): Promise<Response> {
    return handleGetUser(req, this.kv);
  }

  /**
   * Terminates the current user session.
   *
   * Guarantees:
   * - Session data is cleared.
   * - Response is always successful even if no session exists.
   */
  handleLogout(req: Request): Promise<Response> {
    return handleLogout(req, this.kv);
  }
}

/**
 * Create an auth handler instance
 */
export function createAuthHandler(
  kv: Deno.Kv,
  config: AuthConfig,
): AuthHandler {
  return new AuthHandler(kv, config);
}
