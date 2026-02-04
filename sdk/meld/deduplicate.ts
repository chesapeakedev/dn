// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Deduplicates identical or near-identical paragraphs and bullet blocks,
 * and collapses redundant headings (e.g. multiple "Overview" sections).
 * Uses normalized line/block comparison to detect duplicates.
 */
export function deduplicateBlocks(content: string): string {
  if (content.trim() === "") return "";

  const lines = content.split("\n");
  const seen = new Set<string>();
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines but keep single blank between blocks
    if (trimmed === "") {
      if (result.length > 0 && result[result.length - 1] !== "") {
        result.push("");
      }
      i++;
      continue;
    }

    // Headings: normalize for comparison (e.g. ## Overview)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const key = headingMatch[2].toLowerCase().trim();
      if (seen.has(`h:${key}`)) {
        i++;
        continue;
      }
      seen.add(`h:${key}`);
      result.push(line);
      i++;
      continue;
    }

    // List items and paragraphs: collect block and check for duplicate
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      block.push(lines[i]);
      i++;
    }
    const blockText = block
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean)
      .join(" ");
    const blockKey = blockText.slice(0, 120);
    if (blockKey && seen.has(`b:${blockKey}`)) {
      continue;
    }
    if (blockKey) seen.add(`b:${blockKey}`);
    result.push(...block);
    if (i < lines.length && lines[i].trim() === "") {
      result.push("");
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
