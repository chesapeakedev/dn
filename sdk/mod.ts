// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * @chesapeake/dn - Unified SDK for the dn monorepo
 *
 * This package combines authentication utilities, GitHub/VCS utilities,
 * archive utilities, and meld utilities into a single SDK.
 *
 * @module
 */

// ============================================================================
// Auth - Authentication utilities for OAuth and session management
// ============================================================================

// Auth Types
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
} from "./auth/types.ts";

// Session management
export {
  createSessionCookie,
  deleteSession,
  extractSessionId,
  getSessionFromCookie,
  storeSession,
} from "./auth/session.ts";

// GitHub OAuth
export {
  exchangeCodeForGitHubToken,
  getGitHubUser,
  handleGitHubAuth,
  handleGitHubCallback,
} from "./auth/github.ts";

// Google OAuth
export {
  exchangeCodeForGoogleToken,
  getGoogleUser,
  handleGoogleAuth,
  handleGoogleCallback,
} from "./auth/google.ts";

// User management
export {
  createOrGetUser,
  handleGetUser,
  handleLogout,
  userHandler,
} from "./auth/user.ts";

// Chat
export { chatHandler } from "./auth/chat.ts";

// KV utilities
export { handleKvOperation } from "./auth/kv.ts";

// Auth handler class
import type { AuthConfig as _AuthConfig } from "./auth/types.ts";
import {
  handleGitHubAuth as _handleGitHubAuth,
  handleGitHubCallback as _handleGitHubCallback,
} from "./auth/github.ts";
import {
  handleGoogleAuth as _handleGoogleAuth,
  handleGoogleCallback as _handleGoogleCallback,
} from "./auth/google.ts";
import {
  handleGetUser as _handleGetUser,
  handleLogout as _handleLogout,
} from "./auth/user.ts";

/**
 * Auth handler providing stable OAuth and session-backed endpoints.
 *
 * This class is the primary public entrypoint for authentication.
 * Method behavior and request/response shapes are stable across minor versions.
 */
export class AuthHandler {
  constructor(
    private kv: Deno.Kv,
    private config: _AuthConfig,
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
    return _handleGitHubAuth(req, this.kv, this.config.github, this.config);
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
    return _handleGitHubCallback(req, this.kv, this.config.github, this.config);
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
    return _handleGoogleAuth(req, this.kv, this.config.google, this.config);
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
    return _handleGoogleCallback(req, this.kv, this.config.google, this.config);
  }

  /**
   * Returns the currently authenticated user.
   *
   * Guarantees:
   * - Returns user information when a valid session exists.
   * - Returns an unauthenticated response when no session is present.
   */
  handleGetUser(req: Request): Promise<Response> {
    return _handleGetUser(req, this.kv);
  }

  /**
   * Terminates the current user session.
   *
   * Guarantees:
   * - Session data is cleared.
   * - Response is always successful even if no session exists.
   */
  handleLogout(req: Request): Promise<Response> {
    return _handleLogout(req, this.kv);
  }
}

/**
 * Create an auth handler instance
 */
export function createAuthHandler(
  kv: Deno.Kv,
  config: _AuthConfig,
): AuthHandler {
  return new AuthHandler(kv, config);
}

// ============================================================================
// GitHub - GitHub API and VCS utilities
// ============================================================================

// Shared types
export type { Commit, Issue } from "./github/types.ts";

// Issue CRUD types
export type {
  CommentResult,
  CreateIssueOptions,
  IssueComment,
  IssueListItem,
  IssueResult,
  IssueWithComments,
  ListIssuesOptions,
  UpdateIssueOptions,
} from "./github/types.ts";

// GitHub GraphQL API client
export {
  fetchCommits,
  fetchIssueFromUrl,
  fetchIssuesClosed,
  fetchIssuesOpened,
  getCurrentRepoFromRemote,
  getDefaultBranch,
} from "./github/github-gql.ts";

// Issue CRUD operations
export {
  addIssueComment,
  closeIssue,
  createIssue,
  getIssueWithComments,
  listIssues,
  reopenIssue,
  updateIssue,
} from "./github/github-gql.ts";

// Token resolution
export { resolveGitHubToken } from "./github/token.ts";

// GitHub REST API utilities
export { createPR } from "./github/github.ts";

// Issue utilities
export type { IssueData } from "./github/issue.ts";
export {
  fetchIssueFromUrl as fetchIssue,
  parseIssueFromFile,
  resolveIssueUrlInput,
  writeIssueContext,
} from "./github/issue.ts";

// VCS utilities
export type { GitContext } from "./github/vcs.ts";
export { commitAndPush, detectVcs } from "./github/vcs.ts";

// OpenCode execution
export type { OpenCodeResult } from "./github/opencode.ts";
export { runOpenCode } from "./github/opencode.ts";

// ============================================================================
// Archive - Archive utilities
// ============================================================================

export { commitStaged } from "./archive/commit.ts";
export { deriveCommitMessage } from "./archive/derive.ts";
export {
  formatCommitMessage,
  formatSummary,
  wrapBody,
} from "./archive/format.ts";
export type { CommitMessage } from "./archive/derive.ts";

// ============================================================================
// Meld - Meld utilities
// ============================================================================

export { deduplicateBlocks } from "./meld/deduplicate.ts";
export { ensureAcceptanceCriteriaSection } from "./meld/acceptance.ts";
export type { MeldMode } from "./meld/acceptance.ts";
export { mergeMarkdown } from "./meld/merge.ts";
export { normalizeMarkdown } from "./meld/normalize.ts";
export { isGitHubIssueUrl, resolveSource } from "./meld/resolve.ts";
