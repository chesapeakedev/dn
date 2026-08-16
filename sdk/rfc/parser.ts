// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * RFC frontmatter parsing and content handling.
 */

import { parseFrontmatter } from "../todo/frontmatter.ts";
import { isRfcStatus, type Rfc, type RfcMetadata } from "./types.ts";

/**
 * Extracts RFC metadata from markdown content with YAML frontmatter.
 *
 * @returns null when required fields are missing
 * @throws Error when `status` is present but invalid
 */
export function parseRfcMetadata(content: string): RfcMetadata | null {
  const { frontmatter } = parseFrontmatter(content);
  if (
    frontmatter.id === undefined ||
    frontmatter.title === undefined ||
    frontmatter.status === undefined
  ) {
    return null;
  }

  const id = Number.parseInt(frontmatter.id, 10);
  if (!Number.isFinite(id) || id < 0) {
    return null;
  }

  const title = frontmatter.title;
  if (!title) return null;

  const status = frontmatter.status;
  if (!isRfcStatus(status)) {
    throw new Error(
      `Invalid RFC status: ${status}. Must be one of: draft, review, accepted, implementing, done, superseded`,
    );
  }

  return {
    id,
    title,
    status,
    ...(frontmatter.github_issue
      ? { githubIssue: frontmatter.github_issue }
      : {}),
  };
}

/**
 * Creates RFC markdown with frontmatter and an optional body.
 */
export function createRfcContent(
  metadata: RfcMetadata,
  body: string = "",
): string {
  const frontmatterLines = [
    "---",
    `id: ${metadata.id}`,
    `title: "${metadata.title.replace(/"/g, '\\"')}"`,
    `status: ${metadata.status}`,
  ];
  if (metadata.githubIssue) {
    frontmatterLines.push(
      `github_issue: "${metadata.githubIssue.replace(/"/g, '\\"')}"`,
    );
  }
  frontmatterLines.push("---", "");
  return `${frontmatterLines.join("\n")}${body}`;
}

/**
 * Rewrites known RFC frontmatter fields while preserving other keys and body.
 */
export function updateRfcContent(
  content: string,
  metadata: RfcMetadata,
): string {
  const { frontmatter, body } = parseFrontmatter(content);
  if (Object.keys(frontmatter).length === 0 && !content.startsWith("---")) {
    return createRfcContent(metadata, content);
  }

  const next: Record<string, string> = { ...frontmatter };
  next.id = String(metadata.id);
  next.title = metadata.title;
  next.status = metadata.status;
  if (metadata.githubIssue) {
    next.github_issue = metadata.githubIssue;
  } else {
    delete next.github_issue;
  }

  const orderedKeys = ["id", "title", "status", "github_issue"];
  const lines = ["---"];
  for (const key of orderedKeys) {
    if (next[key] === undefined) continue;
    const value = next[key];
    const needsQuotes = /[\n:"']/.test(value) || key === "title" ||
      key === "github_issue";
    lines.push(
      needsQuotes
        ? `${key}: "${value.replace(/"/g, '\\"')}"`
        : `${key}: ${value}`,
    );
    delete next[key];
  }
  for (const [key, value] of Object.entries(next)) {
    const needsQuotes = /[\n:"']/.test(value);
    lines.push(
      needsQuotes
        ? `${key}: "${value.replace(/"/g, '\\"')}"`
        : `${key}: ${value}`,
    );
  }
  lines.push("---");
  const normalizedBody = body.startsWith("\n") ? body.slice(1) : body;
  return `${lines.join("\n")}\n${normalizedBody}`;
}

/**
 * Computes a SHA-256 hex digest of RFC file contents.
 */
export async function computeContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Reads and validates an RFC markdown file.
 */
export async function readRfc(path: string): Promise<Rfc> {
  const content = await Deno.readTextFile(path);
  const metadata = parseRfcMetadata(content);
  if (!metadata) {
    throw new Error(
      `Invalid RFC format in ${path}: missing required frontmatter fields`,
    );
  }
  return {
    metadata,
    path,
    contentHash: await computeContentHash(content),
  };
}

/**
 * Reads an RFC when present; returns null on missing file.
 */
export async function readRfcIfExists(path: string): Promise<Rfc | null> {
  try {
    return await readRfc(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/**
 * Writes RFC metadata (and optional body) to disk.
 */
export async function writeRfc(
  path: string,
  metadata: RfcMetadata,
  body: string = "",
): Promise<void> {
  await Deno.writeTextFile(path, createRfcContent(metadata, body));
}
