// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

export { deduplicateBlocks } from "./deduplicate.ts";
export { ensureAcceptanceCriteriaSection } from "./acceptance.ts";
export type { MeldMode } from "./acceptance.ts";
export { mergeMarkdown } from "./merge.ts";
export { normalizeMarkdown } from "./normalize.ts";
export { isGitHubIssueUrl, resolveSource } from "./resolve.ts";
