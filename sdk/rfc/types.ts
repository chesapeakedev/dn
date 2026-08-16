// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Types for the in-repo RFC (Request for Comments) corpus.
 */

/** Lifecycle status for an RFC document. */
export type RfcStatus =
  | "draft"
  | "review"
  | "accepted"
  | "implementing"
  | "done"
  | "superseded";

/** Frontmatter metadata stored on each RFC markdown file. */
export interface RfcMetadata {
  /** Monotonic RFC id (1+ for corpus entries; overview may use 0). */
  id: number;
  /** Human-friendly title. */
  title: string;
  /** Current lifecycle status. */
  status: RfcStatus;
  /** Optional GitHub issue URL. */
  githubIssue?: string;
}

/** An RFC document as known to tooling. */
export interface Rfc {
  /** Parsed frontmatter metadata. */
  metadata: RfcMetadata;
  /** Path relative to the repository root (or absolute in tests). */
  path: string;
  /** SHA-256 hex digest of the file contents. */
  contentHash: string;
}

/** Git-committed tooling state under `rfcs/.state.json`. */
export interface RfcState {
  /** Next id to allocate on create. */
  nextId: number;
  /** Index of RFCs keyed by numeric id (JSON keys are strings at rest). */
  rfcs: Record<string, Pick<Rfc, "path" | "metadata" | "contentHash">>;
}

/** All valid {@link RfcStatus} values. */
export const RFC_STATUSES: readonly RfcStatus[] = [
  "draft",
  "review",
  "accepted",
  "implementing",
  "done",
  "superseded",
] as const;

/**
 * Returns whether `value` is a known RFC status.
 */
export function isRfcStatus(value: string): value is RfcStatus {
  return (RFC_STATUSES as readonly string[]).includes(value);
}

/**
 * Returns whether a status transition is allowed.
 *
 * Completing an RFC (`done`) never deletes the file; transitions only update
 * frontmatter and `.state.json`.
 */
export function isValidStatusTransition(
  from: RfcStatus,
  to: RfcStatus,
): boolean {
  if (from === to) return true;
  const allowedTransitions: Record<RfcStatus, RfcStatus[]> = {
    draft: ["review", "accepted", "implementing", "done", "superseded"],
    review: ["draft", "accepted", "implementing", "done", "superseded"],
    accepted: ["implementing", "done", "superseded"],
    implementing: ["accepted", "done", "superseded"],
    done: ["superseded"],
    superseded: [],
  };
  return allowedTransitions[from].includes(to);
}

/**
 * Builds `NNN-kebab-slug.md` from a numeric id and slug or title fragment.
 */
export function generateRfcFilename(id: number, slug: string): string {
  const paddedId = id.toString().padStart(3, "0");
  const kebabSlug = slug
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!kebabSlug) {
    throw new Error(
      "RFC slug must contain at least one alphanumeric character",
    );
  }
  return `${paddedId}-${kebabSlug}.md`;
}

/**
 * Parses the numeric id from an `NNN-slug.md` basename, or null if invalid.
 */
export function parseRfcIdFromFilename(filename: string): number | null {
  const match = filename.match(/^(\d{3})-[a-z0-9-]+\.md$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

/**
 * Parses the slug from an `NNN-slug.md` basename, or null if invalid.
 */
export function parseRfcSlugFromFilename(filename: string): string | null {
  const match = filename.match(/^\d{3}-([a-z0-9-]+)\.md$/);
  if (!match) return null;
  return match[1];
}
