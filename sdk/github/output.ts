// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Output formatting utilities for terminal operations.
 * Provides TTY detection, spinners, and time formatting.
 */

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
