// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Trims leading/trailing whitespace and normalizes blank lines to at most one
 * between blocks (collapse multiple newlines to double newline).
 */
export function normalizeMarkdown(content: string): string {
  const trimmed = content.trim();
  if (trimmed === "") return "";
  return trimmed.replace(/\n{3,}/g, "\n\n");
}
