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
}

/**
 * GitHub OAuth configuration
 */
export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
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
