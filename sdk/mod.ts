// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * @chesapeake/dn - Unified SDK for the dn monorepo
 *
 * This package combines authentication utilities and GitHub/VCS utilities
 * into a single SDK for use across applications.
 *
 * @example
 * ```typescript
 * // Import auth utilities
 * import { AuthHandler, createAuthHandler } from "@chesapeake/dn/auth";
 *
 * // Import GitHub utilities
 * import { fetchIssueFromUrl, detectVcs } from "@chesapeake/dn/github";
 *
 * // Or import everything
 * import * as sdk from "@chesapeake/dn";
 * ```
 *
 * @module
 */

// Public SDK surface
// Intentionally expose only top-level namespaces to avoid leaking internals.
export * as auth from "./auth/mod.ts";
export * as github from "./github/mod.ts";
