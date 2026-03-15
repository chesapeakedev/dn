// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal YAML frontmatter parser for markdown files.
 * Strips a ---delimited block at the start and parses simple key: value pairs.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Result of parsing frontmatter from markdown content.
 */
export interface FrontmatterResult {
  /** Parsed key-value pairs (values are trimmed strings). */
  frontmatter: Record<string, string>;
  /** Body content after the closing ---. */
  body: string;
}

/**
 * Parses a single "key: value" line. Handles quoted values.
 */
function parseLine(line: string): { key: string; value: string } | null {
  const colonIndex = line.indexOf(":");
  if (colonIndex <= 0) return null;
  const key = line.slice(0, colonIndex).trim();
  if (!key) return null;
  let value = line.slice(colonIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return { key, value };
}

/**
 * Strips ---delimited frontmatter from markdown and parses key-value pairs.
 * If no frontmatter block is present, returns empty object and the full content as body.
 *
 * @param content - Full file content
 * @returns Parsed frontmatter and body
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const raw = match[1];
  const body = content.slice(match[0].length);
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) {
      frontmatter[parsed.key] = parsed.value;
    }
  }
  return { frontmatter, body };
}

/**
 * Serializes frontmatter and body back to markdown.
 *
 * @param frontmatter - Key-value pairs (values written as-is; use quotes if they contain colons)
 * @param body - Body content
 */
export function stringifyFrontmatter(
  frontmatter: Record<string, string>,
  body: string,
): string {
  if (Object.keys(frontmatter).length === 0) {
    return body;
  }
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    const needsQuotes = /[\n:"']/.test(v);
    lines.push(
      needsQuotes ? `${k}: "${v.replace(/"/g, '\\"')}"` : `${k}: ${v}`,
    );
  }
  lines.push("---");
  return lines.join("\n") + "\n\n" + body;
}
