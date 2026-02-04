// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

const ACCEPTANCE_CRITERIA_HEADING = /^##\s+Acceptance\s+Criteria\s*$/im;
const CHECKBOX_LINE = /^-\s+\[([\sx])\]\s+(.+)$/gm;

export type MeldMode = "opencode" | "cursor";

function extractFirstH1(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function extractOverviewSnippet(content: string, maxLen: number): string {
  const noFront = content.replace(/^---[\s\S]*?---\s*/i, "").trim();
  const afterH1 = noFront.replace(/^#\s+.+$/m, "").trim();
  const overviewMatch = afterH1.match(
    /^##\s+Overview\s*([\s\S]*?)(?=^##\s+|\z)/im,
  );
  const text = overviewMatch
    ? overviewMatch[1].trim()
    : afterH1.slice(0, maxLen).trim();
  return text.slice(0, maxLen).replace(/\n+/g, " ");
}

function extractCheckboxLabels(content: string): string[] {
  const match = content.match(ACCEPTANCE_CRITERIA_HEADING);
  if (!match || match.index === undefined) return [];

  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextH2 = rest.match(/^##\s+/m);
  const section = nextH2 ? rest.slice(0, nextH2.index) : rest;
  const items: string[] = [];
  let m: RegExpExecArray | null;
  CHECKBOX_LINE.lastIndex = 0;
  while ((m = CHECKBOX_LINE.exec(section)) !== null) {
    items.push(m[2].trim());
  }
  return items;
}

function ensureOneAcceptanceCriteriaSection(body: string): string {
  if (ACCEPTANCE_CRITERIA_HEADING.test(body)) {
    return body;
  }
  return body.trimEnd() + "\n\n## Acceptance Criteria\n\n- [ ] Implement plan";
}

/**
 * Ensures the document has exactly one Acceptance Criteria section with
 * checkboxes. In cursor mode, adds or updates YAML frontmatter per dn/fixtures
 * schema: name, overview, todos, isProject.
 */
export function ensureAcceptanceCriteriaSection(
  content: string,
  mode: MeldMode,
): string {
  const body = ensureOneAcceptanceCriteriaSection(content);
  if (mode === "opencode") {
    return body;
  }

  const name = extractFirstH1(
    body.replace(/^---[\s\S]*?---\s*/i, "").trim(),
  ) || "Plan";
  const overview = extractOverviewSnippet(body, 300);
  const todos = extractCheckboxLabels(body);

  const frontmatter = [
    "---",
    `name: ${name}`,
    overview ? `overview: "${overview.replace(/"/g, '\\"')}"` : 'overview: ""',
    `todos: ${JSON.stringify(todos)}`,
    "isProject: false",
    "---",
  ].join("\n");

  const bodyWithoutFrontmatter = body.replace(/^---[\s\S]*?---\s*/i, "").trim();
  return frontmatter + "\n\n" + bodyWithoutFrontmatter;
}
