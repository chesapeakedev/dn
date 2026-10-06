// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  agentPhaseTimeoutWarningMs,
  resolveAgentPhaseTimeoutMs,
} from "./agentPhaseTimeout.ts";
import { formatElapsedTime, formatWarning, type Spinner } from "./output.ts";
import type { ProgressReporter } from "./progress.ts";

const LONG_RUN_WARNING_MS = 300_000;

/** Builds a timeout error message for an agent harness phase. */
export function buildAgentPhaseTimeoutMessage(
  label: string,
  phase: "plan" | "implement",
  timeoutMs: number,
  envHint: string,
): string {
  return `${label} ${phase} phase timed out after ${
    Math.round(timeoutMs / 1000)
  }s. ${envHint}`;
}

/** Resolves timeout for a harness, honoring harness-specific env when set. */
export function resolveHarnessPhaseTimeoutMs(
  phase: "plan" | "implement",
  harnessEnvName: string,
): number {
  const raw = Deno.env.get(harnessEnvName)?.trim();
  const harnessTimeoutMs = raw ? parseInt(raw, 10) : undefined;
  return resolveAgentPhaseTimeoutMs(phase, {
    harnessTimeoutMs: Number.isFinite(harnessTimeoutMs) && harnessTimeoutMs! > 0
      ? harnessTimeoutMs
      : undefined,
  });
}

/** Starts interval logging and optional progress warnings for a long agent phase. */
export function startAgentPhaseProgressMonitor(options: {
  phase: "plan" | "implement";
  timeoutMs: number;
  attended: boolean;
  label: string;
  reporter?: ProgressReporter;
  spinner?: Spinner | null;
}): () => void {
  const startTime = Date.now();
  const timeoutWarningMs = agentPhaseTimeoutWarningMs(options.timeoutMs);
  let didEmitTimeoutWarning = false;
  let didEmitLongRunWarning = false;

  const interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (options.spinner && elapsed > 5000) {
      options.spinner.setMessage(
        `${options.label} ${options.phase} phase... (${
          formatElapsedTime(elapsed)
        })`,
      );
    }
    if (options.attended) return;

    if (
      !didEmitLongRunWarning &&
      elapsed > LONG_RUN_WARNING_MS &&
      elapsed < timeoutWarningMs
    ) {
      didEmitLongRunWarning = true;
      console.warn(
        formatWarning(
          `${options.label} ${options.phase} phase has been running for ${
            Math.round(elapsed / 1000)
          }s.`,
        ),
      );
    }
    if (elapsed > timeoutWarningMs) {
      const remaining = Math.max(0, options.timeoutMs - elapsed);
      if (!didEmitTimeoutWarning) {
        didEmitTimeoutWarning = true;
        console.warn(
          formatWarning(
            `Approaching timeout (${Math.round(remaining / 1000)}s remaining).`,
          ),
        );
        void options.reporter?.report({
          type: "phase.timeout_warning",
          phase: options.phase,
          message:
            `${options.label} ${options.phase} phase approaching timeout (${
              Math.round(remaining / 1000)
            }s remaining).`,
          data: {
            remaining_ms: remaining,
            timeout_ms: options.timeoutMs,
          },
        });
      }
    }
  }, 30_000);

  return () => clearInterval(interval);
}
