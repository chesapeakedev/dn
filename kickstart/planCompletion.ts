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
 * checkboxes in the document body (for living plans like `plans/todo.plan.md`).
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
