// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Meld module exports
 *
 * Provides utilities for merging and processing markdown sources.
 */

export { isGitHubIssueUrl } from "./resolve.ts";
export { meldTargetSystemPromptFile } from "./prompts.ts";
export { parseMeldTarget, resolveContributingMarkdownPath } from "./target.ts";
export type { MeldGitHubTarget, ParsedMeldTarget } from "./target.ts";
export type { MeldTargetKind } from "./target.ts";
