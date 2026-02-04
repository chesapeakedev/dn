// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Output formatting utilities for kickstart.
 * Provides TTY detection, spinners, and consistent message formatting.
 *
 * Core utilities (isTty, Spinner, formatElapsedTime) are re-exported from @dn/sdk/github.
 * Kickstart-specific formatting functions are defined here.
 */

// Re-export core utilities from SDK
export { formatElapsedTime, isTty, Spinner } from "../sdk/github/output.ts";

/**
 * Detects if running in a CI environment.
 * Checks common CI environment variables set by popular CI systems.
 *
 * @returns true if running in CI, false otherwise
 */
export function isCI(): boolean {
  // CI is a standard env var set by GitHub Actions, GitLab CI, CircleCI, Travis, etc.
  // Also check for specific CI system variables as a fallback
  const env = Deno.env;
  return (
    env.get("CI") === "true" ||
    env.get("CI") === "1" ||
    env.get("GITHUB_ACTIONS") === "true" ||
    env.get("GITLAB_CI") === "true" ||
    env.get("CIRCLECI") === "true" ||
    env.get("TRAVIS") === "true" ||
    env.get("JENKINS_URL") !== undefined ||
    env.get("BUILDKITE") === "true"
  );
}

/**
 * Configures the environment for CI mode if detected.
 * Sets NO_COLOR=1 to disable ANSI color codes in output.
 * This should be called early in the application lifecycle.
 *
 * @returns true if CI mode was configured, false otherwise
 */
export function configureForCI(): boolean {
  if (isCI() && !Deno.env.get("NO_COLOR")) {
    Deno.env.set("NO_COLOR", "1");
    return true;
  }
  return false;
}

/**
 * Format a step message.
 * @param step - Step number
 * @param message - Step description
 * @returns Formatted step message
 */
export function formatStep(step: number, message: string): string {
  return `Step ${step}: ${message}`;
}

/**
 * Format a success message.
 * @param message - Success message
 * @returns Formatted success message
 */
export function formatSuccess(message: string): string {
  return `✅ ${message}`;
}

/**
 * Format a warning message.
 * @param message - Warning message
 * @returns Formatted warning message
 */
export function formatWarning(message: string): string {
  return `⚠️  ${message}`;
}

/**
 * Format an error message.
 * @param message - Error message
 * @returns Formatted error message
 */
export function formatError(message: string): string {
  return `❌ Error: ${message}`;
}

/**
 * Format an info message.
 * @param message - Info message
 * @returns Formatted info message
 */
export function formatInfo(message: string): string {
  return `ℹ️  ${message}`;
}

/**
 * Print a section separator.
 * @param text - Optional text to display in the separator
 */
export function printSeparator(text?: string): void {
  if (text) {
    console.log("\n" + "=".repeat(60));
    console.log(text);
    console.log("=".repeat(60));
  } else {
    console.log("=".repeat(60));
  }
}
