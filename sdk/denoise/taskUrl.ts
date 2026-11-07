// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Parse Denoise task page URLs for `dn kickstart` and meld.
 *
 * Accepted SPA paths (on allowed hosts):
 * - `https://{host}/t/{shortCode}` (preferred)
 * - `https://{host}/task/{taskId}`
 * - `https://{host}/milestone/{milestoneId}/task/{taskId}` (legacy)
 */

/** How to call the Denoise task ref API for this URL. */
export type DenoiseTaskUrlKind = "short_code" | "task_id" | "milestone";

/** Parsed Denoise task page URL. */
export interface ParsedDenoiseTaskUrl {
  /** API/browser origin without path (e.g. `https://denoise.cloud`). */
  origin: string;
  kind: DenoiseTaskUrlKind;
  /** Collaborative list id when `kind` is `milestone`. */
  milestoneId?: string;
  /** Todo UUID when `kind` is `milestone` or `task_id`. */
  taskId?: string;
  /** Share code when `kind` is `short_code`. */
  shortCode?: string;
}

const LEGACY_TASK_PATH = /^\/milestone\/([^/]+)\/task\/([^/]+)\/?$/;
const TASK_ID_PATH = /^\/task\/([^/]+)\/?$/;
const SHORT_TASK_PATH = /^\/t\/([^/]+)\/?$/;

const SHORT_CODE_RE =
  /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz]{8}$/;

const ALLOWED_HOST_PATTERNS: readonly RegExp[] = [
  /^denoise\.cloud$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/i,
  /^denoise-qa(?:-[0-9]+)?\.exe\.xyz$/i,
];

function isAllowedDenoiseHost(hostname: string): boolean {
  const host = hostname.split(":")[0].toLowerCase();
  return ALLOWED_HOST_PATTERNS.some((re) => re.test(host));
}

/**
 * Returns true when `input` is a Denoise task page URL.
 */
export function isDenoiseTaskUrl(input: string): boolean {
  return parseDenoiseTaskUrl(input) != null;
}

/**
 * Parse Denoise task URLs on allowed hosts.
 */
export function parseDenoiseTaskUrl(
  input: string,
): ParsedDenoiseTaskUrl | null {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (!isAllowedDenoiseHost(url.hostname)) {
    return null;
  }

  const legacy = LEGACY_TASK_PATH.exec(url.pathname);
  if (legacy) {
    const milestoneId = decodeURIComponent(legacy[1]);
    const taskId = decodeURIComponent(legacy[2]);
    if (milestoneId === "" || taskId === "") return null;
    return {
      origin: url.origin,
      kind: "milestone",
      milestoneId,
      taskId,
    };
  }

  const shortMatch = SHORT_TASK_PATH.exec(url.pathname);
  if (shortMatch) {
    const shortCode = decodeURIComponent(shortMatch[1]);
    if (!SHORT_CODE_RE.test(shortCode)) return null;
    return {
      origin: url.origin,
      kind: "short_code",
      shortCode,
    };
  }

  const taskMatch = TASK_ID_PATH.exec(url.pathname);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    if (taskId === "") return null;
    return {
      origin: url.origin,
      kind: "task_id",
      taskId,
    };
  }

  return null;
}
