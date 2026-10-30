// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Parse Denoise milestone task page URLs for `dn kickstart` and meld.
 *
 * Accepted shape: `https://{host}/milestone/{milestoneId}/task/{taskId}`
 * Host allowlist: denoise.cloud, localhost, 127.0.0.1, denoise-qa*.exe.xyz.
 */

/** Parsed canonical Denoise milestone task URL. */
export interface ParsedDenoiseTaskUrl {
  /** API/browser origin without path (e.g. `https://denoise.cloud`). */
  origin: string;
  /** Collaborative list id (milestone UUID). */
  milestoneId: string;
  /** Todo UUID (`todo.id`). */
  taskId: string;
}

const DENOISE_TASK_PATH = /^\/milestone\/([^/]+)\/task\/([^/]+)\/?$/;

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
 * Returns true when `input` is a Denoise milestone task page URL.
 */
export function isDenoiseTaskUrl(input: string): boolean {
  return parseDenoiseTaskUrl(input) != null;
}

/**
 * Parse `https://{host}/milestone/{milestoneId}/task/{taskId}`.
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
  const match = DENOISE_TASK_PATH.exec(url.pathname);
  if (!match) return null;
  const milestoneId = decodeURIComponent(match[1]);
  const taskId = decodeURIComponent(match[2]);
  if (milestoneId === "" || taskId === "") return null;
  return {
    origin: url.origin,
    milestoneId,
    taskId,
  };
}
