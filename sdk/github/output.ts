// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Output formatting utilities for terminal operations.
 * Provides TTY detection, CI/unattended detection, color policy, spinners, and time formatting.
 * See https://no-color.org and https://force-color.org for env semantics.
 */

/** Module-level overrides set by CLI bootstrap (e.g. from --unattended, --no-color, --color). */
let unattendedOverride: boolean | null = null;
let noColorOverride: boolean | null = null;
let forceColorOverride: boolean | null = null;

/**
 * Detects if running in a CI environment.
 * Checks common CI environment variables set by popular CI systems.
 * List: CI, GITHUB_ACTIONS, GITLAB_CI, CIRCLECI, TRAVIS, JENKINS_URL, BUILDKITE,
 * TEAMCITY_VERSION, Azure DevOps (SYSTEM_TEAMFOUNDATIONCOLLECTIONURI).
 *
 * @returns true if running in CI, false otherwise
 */
export function isCI(): boolean {
  const env = Deno.env;
  return (
    env.get("CI") === "true" ||
    env.get("CI") === "1" ||
    env.get("GITHUB_ACTIONS") === "true" ||
    env.get("GITLAB_CI") === "true" ||
    env.get("CIRCLECI") === "true" ||
    env.get("TRAVIS") === "true" ||
    env.get("JENKINS_URL") !== undefined ||
    env.get("BUILDKITE") === "true" ||
    env.get("TEAMCITY_VERSION") !== undefined ||
    env.get("SYSTEM_TEAMFOUNDATIONCOLLECTIONURI") !== undefined
  );
}

/**
 * Configures the environment for CI mode if detected.
 * Sets NO_COLOR=1 to disable ANSI color codes in output.
 * Should be called early at CLI entry (e.g. from bootstrap).
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
 * Whether output is in unattended mode (CI, non-TTY, or explicit flag).
 * In unattended mode: no spinners, minimal decoration, no interactive prompts,
 * ASCII-friendly markers preferred over emoji.
 */
export function isUnattended(): boolean {
  if (unattendedOverride !== null) {
    return unattendedOverride;
  }
  return isCI() || !isTty();
}

/**
 * Whether ANSI color/decoration should be emitted.
 * Respects NO_COLOR (any value disables), FORCE_COLOR (enables when not TTY),
 * TERM=dumb (no color), and CLI overrides (--no-color, --color).
 */
export function isColorEnabled(): boolean {
  if (
    Deno.env.get("NO_COLOR") !== undefined && Deno.env.get("NO_COLOR") !== ""
  ) {
    return false;
  }
  if (noColorOverride === true) {
    return false;
  }
  if (
    forceColorOverride === true || Deno.env.get("FORCE_COLOR") !== undefined
  ) {
    return true;
  }
  if (Deno.env.get("TERM") === "dumb") {
    return false;
  }
  return isTty();
}

/**
 * Bootstrap output policy from environment and optional CLI overrides.
 * Call once at CLI entry: first with no args to apply CI NO_COLOR, then
 * with parsed flags (unattended, noColor, forceColor) after parsing global flags.
 *
 * @param opts - Optional overrides from global flags (--unattended, --no-color, --color)
 */
export function bootstrapFromEnv(opts?: {
  unattended?: boolean;
  noColor?: boolean;
  forceColor?: boolean;
}): void {
  if (opts === undefined) {
    configureForCI();
    return;
  }
  if (opts.unattended !== undefined) {
    unattendedOverride = opts.unattended;
  }
  if (opts.noColor !== undefined) {
    noColorOverride = opts.noColor;
  }
  if (opts.forceColor !== undefined) {
    forceColorOverride = opts.forceColor;
  }
}

/**
 * Set unattended mode explicitly (for tests).
 * @param value - true to force unattended, false to clear override
 */
export function setUnattended(value: boolean): void {
  unattendedOverride = value;
}

/**
 * Check if stdout is a TTY (interactive terminal).
 * @returns true if stdout is a TTY, false otherwise
 */
export function isTty(): boolean {
  try {
    return Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

/**
 * Spinner frames for animation
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Animated spinner for TTY mode.
 * Shows a spinning animation while a long-running operation is in progress.
 */
export class Spinner {
  private message: string;
  private frameIndex: number = 0;
  private intervalId: number | null = null;
  private isRunning: boolean = false;

  constructor(message: string) {
    this.message = message;
  }

  /**
   * Start the spinner animation.
   * Only works in TTY mode.
   */
  start(): void {
    if (!isTty() || this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.frameIndex = 0;
    this.update();

    // Update spinner every 150ms
    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.update();
    }, 150) as unknown as number;
  }

  /**
   * Stop the spinner and clear the line.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.isRunning && isTty()) {
      // Clear the spinner line
      Deno.stdout.writeSync(new TextEncoder().encode("\r\x1b[K"));
    }

    this.isRunning = false;
  }

  /**
   * Update the spinner display.
   */
  private update(): void {
    if (!isTty() || !this.isRunning) {
      return;
    }

    const frame = SPINNER_FRAMES[this.frameIndex];
    const text = `\r${this.message} ${frame}`;
    Deno.stdout.writeSync(new TextEncoder().encode(text));
  }

  /**
   * Update the spinner message.
   */
  setMessage(message: string): void {
    this.message = message;
    if (this.isRunning) {
      this.update();
    }
  }
}

/**
 * Format elapsed time in a human-readable way.
 * @param elapsedMs - Elapsed time in milliseconds
 * @returns Formatted time string (e.g., "45s", "2m 30s")
 */
export function formatElapsedTime(elapsedMs: number): string {
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}
