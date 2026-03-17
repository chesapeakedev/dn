// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * CLI output policy and formatting.
 * Central place for unattended/color detection and [dn]-branded formatting.
 * Re-exports TTY, spinner, and elapsed time from SDK; adds formatStep, formatSuccess, etc.
 */

import {
  bootstrapFromEnv as sdkBootstrapFromEnv,
  configureForCI,
  formatElapsedTime,
  isCI,
  isColorEnabled,
  isTty,
  isUnattended,
  setUnattended,
  Spinner,
} from "../sdk/github/output.ts";

export {
  configureForCI,
  formatElapsedTime,
  isCI,
  isColorEnabled,
  isTty,
  isUnattended,
  setUnattended,
  Spinner,
};

/** Consistent prefix for dn-originated lines so logs are identifiable. */
const DN_PREFIX = "[dn] ";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
} as const;

/**
 * Bootstrap output policy at CLI entry. Call with no args first (applies CI NO_COLOR),
 * then with parsed global flags after parsing --unattended, --no-color, --color.
 */
export function bootstrapFromEnv(opts?: {
  unattended?: boolean;
  noColor?: boolean;
  forceColor?: boolean;
}): void {
  sdkBootstrapFromEnv(opts);
}

/**
 * Format a step message with [dn] branding.
 * Attended + color: bold step label; unattended: ASCII-only with [dn] prefix.
 */
export function formatStep(step: number, message: string): string {
  const base = `Step ${step}: ${message}`;
  if (isUnattended()) {
    return DN_PREFIX + base;
  }
  if (isColorEnabled()) {
    return `${ANSI.bold}${DN_PREFIX}${base}${ANSI.reset}`;
  }
  return DN_PREFIX + base;
}

/**
 * Format a success message. Attended: green + emoji; unattended: [dn] [OK] message.
 */
export function formatSuccess(message: string): string {
  if (isUnattended()) {
    return `${DN_PREFIX}[OK] ${message}`;
  }
  if (isColorEnabled()) {
    return `${ANSI.green}${DN_PREFIX}✅ ${message}${ANSI.reset}`;
  }
  return `${DN_PREFIX}✅ ${message}`;
}

/**
 * Format a warning message. Attended: yellow + emoji; unattended: [dn] [WARN] message.
 */
export function formatWarning(message: string): string {
  if (isUnattended()) {
    return `${DN_PREFIX}[WARN] ${message}`;
  }
  if (isColorEnabled()) {
    return `${ANSI.yellow}${DN_PREFIX}⚠️  ${message}${ANSI.reset}`;
  }
  return `${DN_PREFIX}⚠️  ${message}`;
}

/**
 * Format an error message. Attended: red + emoji; unattended: [dn] [ERROR] message.
 */
export function formatError(message: string): string {
  if (isUnattended()) {
    return `${DN_PREFIX}[ERROR] ${message}`;
  }
  if (isColorEnabled()) {
    return `${ANSI.red}${DN_PREFIX}❌ Error: ${message}${ANSI.reset}`;
  }
  return `${DN_PREFIX}❌ Error: ${message}`;
}

/**
 * Format an info message. Attended: cyan + emoji; unattended: [dn] message.
 */
export function formatInfo(message: string): string {
  if (isUnattended()) {
    return DN_PREFIX + message;
  }
  if (isColorEnabled()) {
    return `${ANSI.cyan}${DN_PREFIX}ℹ️  ${message}${ANSI.reset}`;
  }
  return `${DN_PREFIX}ℹ️  ${message}`;
}

/**
 * Print a section separator. Optional text is prefixed with [dn] when provided.
 */
export function printSeparator(text?: string): void {
  if (text) {
    console.log("\n" + "=".repeat(60));
    console.log(DN_PREFIX + text);
    console.log("=".repeat(60));
  } else {
    console.log("=".repeat(60));
  }
}
