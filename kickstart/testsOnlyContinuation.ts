// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Attended-only UX: when implement leftovers are tests-only, confirm and
 * optionally run one more implement pass focused on tests.
 */

import { promptYesNo } from "../sdk/github/filePrompt.ts";
import { isUnattended } from "../sdk/github/output.ts";
import {
  type ImplementPhaseResult,
  onlyTestsRemaining,
} from "./implementResult.ts";

/** Steering block injected for a tests-only continuation implement pass. */
export const TESTS_ONLY_STEERING_PROMPT =
  `Remaining work is tests-only. Do not change product behavior, public APIs, or CLI semantics unless a test cannot be written correctly without a tiny fix. Focus exclusively on writing or updating tests for already-implemented behavior, mark matching Acceptance Criteria checkboxes complete when done, and rewrite .dn/implement-result.json to match reality.`;

/**
 * True when attended mode may offer a tests-only continuation for this result.
 *
 * Unattended mode never offers (no prompt, no auto-run).
 */
export function shouldOfferTestsOnlyContinuation(
  result: ImplementPhaseResult | null | undefined,
): boolean {
  if (isUnattended()) return false;
  if (result == null) return false;
  return onlyTestsRemaining(result);
}

/**
 * Prompts the operator to run another implement pass for remaining tests.
 *
 * Call only after {@link shouldOfferTestsOnlyContinuation} is true. Default is
 * No. Unattended callers should not reach this (gate returns false first).
 */
export function confirmTestsOnlyContinuation(): boolean {
  if (isUnattended()) return false;
  return promptYesNo(
    "Only tests remain. Run another implement pass to write tests now?",
    {
      defaultYes: false,
      autoApproveIfUnattended: false,
      unattendedHint:
        "tests-only continuation is skipped in unattended mode (no auto-run).",
    },
  );
}

/**
 * Merges tests-only steering with any existing operator steering prompt.
 */
export function mergeTestsOnlySteering(
  existingSteeringPrompt?: string,
): string {
  const existing = existingSteeringPrompt?.trim();
  if (!existing) return TESTS_ONLY_STEERING_PROMPT;
  return `${TESTS_ONLY_STEERING_PROMPT}\n\n${existing}`;
}
