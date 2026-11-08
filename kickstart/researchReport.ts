// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Validates research report markdown written by the research-phase agent.
 */

const REQUIRED_SECTIONS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Title (H1)", pattern: /^#\s+.+$/m },
  { label: "Summary", pattern: /^##\s+Summary/mi },
  { label: "Request Context", pattern: /^##\s+Request\s+Context/mi },
  { label: "Code Pointers", pattern: /^##\s+Code\s+Pointers/mi },
  {
    label: "Likely Affected Areas",
    pattern: /^##\s+Likely\s+Affected\s+Areas/mi,
  },
  { label: "Suggested Approach", pattern: /^##\s+Suggested\s+Approach/mi },
];

const FORBIDDEN_SECTIONS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "Implementation Plan",
    pattern: /^##\s+Implementation\s+Plan/mi,
  },
  {
    label: "Acceptance Criteria",
    pattern: /^##\s+Acceptance\s+Criteria/mi,
  },
];

/**
 * Returns validation errors for report content, or an empty array when valid.
 */
export function validateResearchReportContent(content: string): string[] {
  const errors: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) {
    return ["Research report is empty."];
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!section.pattern.test(content)) {
      errors.push(`Missing required section: ${section.label}`);
    }
  }

  for (const section of FORBIDDEN_SECTIONS) {
    if (section.pattern.test(content)) {
      errors.push(
        `Report must not include ${section.label}; use Suggested Approach only.`,
      );
    }
  }

  return errors;
}

/**
 * Validates a research report file on disk.
 *
 * @throws Error when the file is missing, empty, or fails section checks
 */
export async function checkResearchReport(reportPath: string): Promise<void> {
  let content: string;
  try {
    content = await Deno.readTextFile(reportPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Research report not found at ${reportPath}. The research agent must write the staging file.`,
      );
    }
    throw error;
  }

  const errors = validateResearchReportContent(content);
  if (errors.length > 0) {
    throw new Error(
      `Research report validation failed: ${errors.join("; ")}`,
    );
  }
}
