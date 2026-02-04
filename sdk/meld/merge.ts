// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { deduplicateBlocks } from "./deduplicate.ts";
import { normalizeMarkdown } from "./normalize.ts";

const ACCEPTANCE_CRITERIA_HEADING = /^##\s+Acceptance\s+Criteria\s*$/im;
const CHECKBOX_LINE = /^-\s+\[([\sx])\]\s+(.+)$/gm;

function stripFrontmatter(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("---", 3);
    if (end !== -1) {
      return trimmed.slice(end + 3).trim();
    }
  }
  return trimmed;
}

function extractAcceptanceCriteriaItems(content: string): string[] {
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

function removeAcceptanceCriteriaSection(content: string): string {
  const match = content.match(ACCEPTANCE_CRITERIA_HEADING);
  if (!match || match.index === undefined) return content;

  const start = match.index;
  const rest = content.slice(start);
  const nextH2 = rest.match(/\n##\s+/);
  const end = nextH2 ? start + (nextH2.index ?? rest.length) : content.length;
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end).trimStart();
  return [before, after].filter(Boolean).join("\n\n");
}

/**
 * Structurally merges multiple markdown sources: normalizes each, concatenates,
 * merges Acceptance Criteria sections into one deduplicated list, and runs a
 * final deduplicate pass.
 */
export function mergeMarkdown(sources: string[]): string {
  const normalized = sources
    .map((s) => normalizeMarkdown(stripFrontmatter(s)))
    .filter(Boolean);
  if (normalized.length === 0) return "";

  const allAcItems: string[] = [];
  const bodies: string[] = [];

  for (const block of normalized) {
    const items = extractAcceptanceCriteriaItems(block);
    allAcItems.push(...items);
    bodies.push(removeAcceptanceCriteriaSection(block));
  }

  const combined = bodies.join("\n\n---\n\n");
  const deduped = deduplicateBlocks(combined);

  const acDeduped = [
    ...new Set(allAcItems.map((t) => t.trim()).filter(Boolean)),
  ];
  const acSection = acDeduped.length > 0
    ? "\n\n## Acceptance Criteria\n\n" +
      acDeduped.map((t) => `- [ ] ${t}`).join("\n")
    : "\n\n## Acceptance Criteria\n\n- [ ] Implement plan";

  return (deduped + acSection).replace(/\n{3,}/g, "\n\n").trim();
}
