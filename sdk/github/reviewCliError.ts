// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Machine-readable failure envelope for `dn review --json`. */
export interface ReviewCliFailure {
  schemaVersion: "1.0";
  ok: false;
  error: {
    code:
      | "invalid-reference"
      | "missing-argument"
      | "mutation-forbidden"
      | "unknown-option"
      | "review-failed";
    message: string;
  };
}

function classifyReviewErrorMessage(
  message: string,
): ReviewCliFailure["error"]["code"] {
  if (
    message.includes("dn kickstart") || message.includes("pull request URL")
  ) {
    return "invalid-reference";
  }
  if (
    message.includes("Provide exactly one") ||
    message.includes("Provide a GitHub")
  ) {
    return "missing-argument";
  }
  if (message.includes("read-only") || message.includes("mutation")) {
    return "mutation-forbidden";
  }
  if (message.startsWith("Unknown option:")) {
    return "unknown-option";
  }
  return "review-failed";
}

/** Maps a thrown error to the versioned JSON failure document. */
export function reviewFailureDocument(error: unknown): ReviewCliFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    schemaVersion: "1.0",
    ok: false,
    error: {
      code: classifyReviewErrorMessage(message),
      message,
    },
  };
}
