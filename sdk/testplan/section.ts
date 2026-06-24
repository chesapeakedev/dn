// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

const TEST_PLAN_HEADER = "## Test Plan";
const TEST_PLAN_SECTION = /^##\s+Test\s+Plan\s*$/im;
const NEXT_H2 = /^##\s+/m;
const BULLET = /^\s*-\s+(?:\[[ xX]\]\s+)?\S+/gm;
const MAX_TEST_PLAN_ITEMS = 12;

/**
 * Normalizes an agent-produced test plan section.
 *
 * @param content - Agent output containing a `## Test Plan` section or a raw list
 * @returns A compact `## Test Plan` section ready to splice into a source artifact
 */
export function normalizeTestPlanSection(content: string): string {
  const trimmed = content.trim();
  if (trimmed === "") {
    throw new Error("Generated test plan is empty.");
  }

  const section = extractTestPlanSection(trimmed) ??
    `${TEST_PLAN_HEADER}\n\n${trimmed}`;
  validateTestPlanSection(section);
  return section.trimEnd() + "\n";
}

/**
 * Inserts or replaces the `## Test Plan` section in a markdown document.
 *
 * @param source - Existing plan or GitHub issue body
 * @param testPlanSection - Normalized `## Test Plan` section
 * @returns Updated markdown with unrelated content preserved
 */
export function upsertTestPlanSection(
  source: string,
  testPlanSection: string,
): string {
  const normalizedSection = normalizeTestPlanSection(testPlanSection).trimEnd();
  const match = source.match(TEST_PLAN_SECTION);

  if (match && match.index !== undefined) {
    const start = match.index;
    const rest = source.slice(start + match[0].length);
    const next = rest.match(NEXT_H2);
    const end = next && next.index !== undefined
      ? start + match[0].length + next.index
      : source.length;
    return [
      source.slice(0, start).trimEnd(),
      normalizedSection,
      source.slice(end).trimStart(),
    ].filter((part) => part.length > 0).join("\n\n") + trailingNewline(source);
  }

  const acceptance = source.match(/^##\s+Acceptance\s+Criteria\s*$/im);
  if (acceptance && acceptance.index !== undefined) {
    const start = acceptance.index;
    const rest = source.slice(start + acceptance[0].length);
    const next = rest.match(NEXT_H2);
    const insertAt = next && next.index !== undefined
      ? start + acceptance[0].length + next.index
      : source.length;
    return [
      source.slice(0, insertAt).trimEnd(),
      normalizedSection,
      source.slice(insertAt).trimStart(),
    ].filter((part) => part.length > 0).join("\n\n") + trailingNewline(source);
  }

  return [source.trimEnd(), normalizedSection].filter((part) => part.length > 0)
    .join("\n\n") + trailingNewline(source);
}

function extractTestPlanSection(content: string): string | null {
  const match = content.match(TEST_PLAN_SECTION);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = match.index;
  return content.slice(start).trim();
}

function validateTestPlanSection(section: string): void {
  if (!TEST_PLAN_SECTION.test(section)) {
    throw new Error(
      "Generated test plan must include a `## Test Plan` header.",
    );
  }
  const testPlanOnly = extractSingleSection(section) ?? section;
  const bullets = [...testPlanOnly.matchAll(BULLET)];
  if (bullets.length === 0) {
    throw new Error("Generated test plan must include at least one bullet.");
  }
  if (bullets.length > MAX_TEST_PLAN_ITEMS) {
    throw new Error(
      `Generated test plan has ${bullets.length} bullets; keep it to ${MAX_TEST_PLAN_ITEMS} or fewer.`,
    );
  }
}

function extractSingleSection(content: string): string | null {
  const match = content.match(TEST_PLAN_SECTION);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = match.index;
  const rest = content.slice(start + match[0].length);
  const next = rest.match(NEXT_H2);
  const end = next && next.index !== undefined
    ? start + match[0].length + next.index
    : content.length;
  return content.slice(start, end);
}

function trailingNewline(source: string): string {
  return source.endsWith("\n") ? "\n" : "";
}
