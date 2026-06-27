// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** One commit in a land plan. */
export interface LandCommitGroup {
  /** Repository-relative paths to include in this commit. */
  files: string[];
  /** Conventional-commit subject line. */
  summary: string;
  /** Optional commit body. */
  body?: string;
}

/** Ordered commits produced by the land agent or `--single` mode. */
export type LandCommitPlan = LandCommitGroup[];
