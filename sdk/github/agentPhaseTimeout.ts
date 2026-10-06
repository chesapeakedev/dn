// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Default wall-clock budget for the plan agent phase (10 minutes). */
export const DEFAULT_PLAN_TIMEOUT_MS = 600_000;

/** Default wall-clock budget for the implement agent phase (20 minutes). */
export const DEFAULT_IMPLEMENT_TIMEOUT_MS = 1_200_000;

/** Parses a positive integer from an environment variable, or returns undefined. */
export function parsePositiveIntEnv(name: string): number | undefined {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return undefined;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Resolves the wall-clock timeout for a kickstart agent phase.
 *
 * Precedence (first match wins):
 * - `PLAN_TIMEOUT_MS` / `IMPLEMENT_TIMEOUT_MS` for the active phase
 * - Harness-specific timeout (e.g. `CODEX_TIMEOUT_MS`) when provided
 * - `OPENCODE_TIMEOUT_MS`
 * - Phase default (plan 10m, implement 20m)
 */
export function resolveAgentPhaseTimeoutMs(
  phase: "plan" | "implement",
  options: { harnessTimeoutMs?: number } = {},
): number {
  const phaseEnv = phase === "plan"
    ? "PLAN_TIMEOUT_MS"
    : "IMPLEMENT_TIMEOUT_MS";
  const phaseSpecific = parsePositiveIntEnv(phaseEnv);
  if (phaseSpecific !== undefined) return phaseSpecific;

  if (options.harnessTimeoutMs !== undefined) {
    return options.harnessTimeoutMs;
  }

  const opencode = parsePositiveIntEnv("OPENCODE_TIMEOUT_MS");
  if (opencode !== undefined) return opencode;

  return phase === "implement"
    ? DEFAULT_IMPLEMENT_TIMEOUT_MS
    : DEFAULT_PLAN_TIMEOUT_MS;
}

/** Warning threshold at 80% of the phase budget (capped at 10 minutes for short phases). */
export function agentPhaseTimeoutWarningMs(timeoutMs: number): number {
  return Math.min(timeoutMs * 0.8, 600_000);
}
