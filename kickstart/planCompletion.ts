// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Plan completion detection from markdown checklists.
 */

/**
 * Parses markdown task checkboxes from a plan section.
 */
function parseMarkdownCheckboxes(
  content: string,
): Array<{ completed: boolean; text: string }> {
  const checkboxPattern = /^-\s+\[([\sx])\]\s+(.+)$/gm;
  const checkboxes: Array<{ completed: boolean; text: string }> = [];
  let match;

  while ((match = checkboxPattern.exec(content)) !== null) {
    checkboxes.push({
      completed: match[1].toLowerCase() === "x",
      text: match[2].trim(),
    });
  }

  return checkboxes;
}

/**
 * Derives completion metrics from parsed checkboxes.
 */
export function completionStatusFromCheckboxes(
  checkboxes: Array<{ completed: boolean; text: string }>,
): {
  complete: boolean;
  total: number;
  completed: number;
  incomplete: string[];
} {
  const total = checkboxes.length;
  const completed = checkboxes.filter((cb) => cb.completed).length;
  const incomplete = checkboxes
    .filter((cb) => !cb.completed)
    .map((cb) => cb.text);

  return {
    complete: total > 0 && completed === total,
    total,
    completed,
    incomplete,
  };
}

/**
 * Derives completion status from plan markdown content.
 *
 * Uses the `## Acceptance Criteria` section when present; otherwise counts all
 * checkboxes in the document body (for living checklist plans).
 */
export function completionStatusFromPlanContent(content: string): {
  complete: boolean;
  total: number;
  completed: number;
  incomplete: string[];
} {
  const body = content.replace(/^---[\s\S]*?---\s*/i, "").trim();
  const acceptanceCriteriaMatch = body.match(
    /^##\s+Acceptance\s+Criteria\s*$/mi,
  );

  let sectionContent: string;
  if (acceptanceCriteriaMatch && acceptanceCriteriaMatch.index !== undefined) {
    const startIndex = acceptanceCriteriaMatch.index +
      acceptanceCriteriaMatch[0].length;
    const restOfContent = body.slice(startIndex);
    const nextSectionMatch = restOfContent.match(/^##\s+/m);
    sectionContent = nextSectionMatch
      ? restOfContent.slice(0, nextSectionMatch.index)
      : restOfContent;
  } else {
    sectionContent = body;
  }

  return completionStatusFromCheckboxes(
    parseMarkdownCheckboxes(sectionContent),
  );
}

/**
 * Creates a durable, transport-safe acceptance report from a plan.
 *
 * This deliberately reports checklist state only. It does not claim that
 * tests or an independent human review passed.
 */
export function acceptanceCriteriaReportFromPlanContent(
  content: string,
  planPath?: string,
): import("../sdk/github/progress.ts").AcceptanceCriteriaReport {
  const body = content.replace(/^---[\s\S]*?---\s*/i, "").trim();
  const sectionMatch = body.match(/^##\s+Acceptance\s+Criteria\s*$/mi);
  const sectionStart = sectionMatch?.index == null
    ? 0
    : sectionMatch.index + sectionMatch[0].length;
  const rest = body.slice(sectionStart);
  const nextSection = sectionMatch ? rest.match(/^##\s+/m) : null;
  const section = nextSection ? rest.slice(0, nextSection.index) : rest;
  const criteria = [...section.matchAll(/^[-*]\s+\[([ xX])\]\s+(.+)$/gm)]
    .map((match) => ({
      text: match[2].trim(),
      completed: match[1].toLowerCase() === "x",
    }));
  const completed = criteria.filter((criterion) => criterion.completed).length;
  return {
    schema_version: "1.0",
    ...(planPath ? { plan_path: planPath } : {}),
    completed,
    total: criteria.length,
    criteria,
    checklist_complete: criteria.length > 0 && completed === criteria.length,
  };
}
