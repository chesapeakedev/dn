// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { TrendDirection } from "./types.ts";

const MS_PER_DAY = 86_400_000;

/**
 * Classify how a current metric compares to the same metric in a prior window.
 * Uses a small relative floor so tiny repos do not flicker on single-count noise.
 */
export function trendDirectionFromCounts(
  current: number,
  prior: number,
): TrendDirection {
  const baseline = Math.max(prior, current, 1);
  const threshold = Math.max(1, Math.ceil(baseline * 0.08));
  if (current > prior + threshold) return "up";
  if (current + threshold < prior) return "down";
  return "flat";
}

/**
 * Compact relative-time phrase for terminal output (UTC calendar days).
 */
export function formatRelativeCalendarDays(
  isoDate: string,
  now: Date = new Date(),
): string {
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return "unknown";
  const then = new Date(t);
  const dayDiff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      MS_PER_DAY,
  );

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (dayDiff === 0) return rtf.format(0, "day");
  if (dayDiff > 0) return rtf.format(-dayDiff, "day");
  return rtf.format(-dayDiff, "day");
}

/**
 * Truncate a title for fixed-width terminals; ellipsis only when shortening.
 *
 * @param maxChars - Approximate grapheme-safe width for Latin text.
 */
export function truncateWithEllipsis(text: string, maxChars: number): string {
  if (maxChars <= 3) return text.slice(0, maxChars);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

/**
 * Renders [████░░░░░░] style bar in `width` total characters including brackets (inner = width - 2).
 */
export function asciiFilledBar(portionOfOne: number, innerWidth = 14): string {
  const clamped = Math.min(1, Math.max(0, portionOfOne));
  const filled = Math.round(clamped * innerWidth);
  const empty = innerWidth - filled;
  return "[" + "=".repeat(filled) + (empty > 0 ? ".".repeat(empty) : "") + "]";
}
