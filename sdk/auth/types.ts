// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * User type representing authenticated user data
 * Matches todo app's User interface exactly
 */
export interface User {
  id: string; // UUID string (todo's pattern)
  avatar_url: string;
  name?: string;
  email?: string;
  githubOAuthId?: string; // todo's pattern
  githubLogin?: string; // GitHub username for searchability
  googleOAuthId?: string; // todo's pattern
}

/**
 * Session type stored in KV
 * Matches todo app's Session interface exactly
 */
export interface Session {
  userId: string; // UUID string (todo's pattern)
  avatar_url: string;
  name?: string;
  email?: string;
  expiresAt: number;
}

/**
 * OAuth state stored temporarily for validation
 */
export interface OAuthState {
  expiresAt: number;
  /** GitHub App installation ID captured during the setup redirect, if any. */
  installationId?: string;
}

/**
 * Result returned by {@linkcode validateGitHubCallback} on success.
 * Contains the resolved user and access token so the consumer can
 * create a session without duplicating token-exchange logic.
 */
export interface GitHubCallbackResult {
  user: User;
  accessToken: string;
}

/**
 * GitHub OAuth configuration
 *
 * When {@linkcode appSlug} is provided, the auth entry point redirects users
 * through the GitHub App installation flow before OAuth, allowing them to
 * install the app on an organization. The slug is the URL-friendly name from
 * `https://github.com/apps/<slug>`.
 */
export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /**
   * GitHub App slug (URL-friendly name) used to build the installation URL.
   * When set, "Sign in with GitHub" redirects to the app installation page
   * before continuing with OAuth. Callers can bypass installation by passing
   * `?flow=oauth_only` on the auth entry request.
   */
  appSlug?: string;
}

/**
 * Google OAuth configuration
 */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Auth SDK configuration
 */
export interface AuthConfig {
  github?: GitHubOAuthConfig;
  google?: GoogleOAuthConfig;
  sessionMaxAge?: number; // in milliseconds, default 7 days
  stateMaxAge?: number; // in milliseconds, default 10 minutes
}

/**
 * User info returned by /api/auth/me endpoint
 * Matches todo app's pattern
 */
export interface UserInfo {
  userId: string; // UUID string (todo's pattern)
  userName: string;
  avatarUrl: string;
  name?: string;
  email?: string;
}

/**
 * OAuth provider type
 */
export type OAuthProvider = "github" | "google";

/**
 * Chat message data for chat functionality
 *
 * Currently handles text messages, gif messages, and custom message types
 *
 * @param id - The unique identifier for the message
 * @param userId - The ID of the user who sent the message
 * @param name - The name of the user who sent the message
 * @param date - The date and time the message was sent
 * @param message - The content of the message
 * @param messageType - The type of message (text, gif, audible, etc.)
 * @param meta - Generic metadata for the message (app-specific)
 */
export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  date: Date;
  message: string;
  messageType?: "text" | "gif" | "audible";
  meta?: Record<string, unknown>;
}
