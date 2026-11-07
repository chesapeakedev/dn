// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { fetchDenoiseTaskRefFromParsed } from "../denoise/fetchTaskRef.ts";
import { isDenoiseTaskUrl, parseDenoiseTaskUrl } from "../denoise/taskUrl.ts";
import { fetchIssueFromUrl } from "../github/issue.ts";
import { resolveGitHubToken } from "../github/token.ts";
import {
  denoiseTaskToMarkdown,
  validateDenoiseTaskDocument,
} from "../runner/types.ts";

const GITHUB_ISSUE_URL =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:\?.*)?$/i;

/**
 * Returns true if the source string looks like a GitHub issue URL.
 */
export function isGitHubIssueUrl(source: string): boolean {
  return GITHUB_ISSUE_URL.test(source.trim());
}

/**
 * Attempts to parse a source as a denoise task JSON document.
 * Returns materialized markdown if successful, null otherwise.
 */
function tryDenoiseTaskJson(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed.endsWith(".json") && !trimmed.endsWith(".jsonc")) {
    return null;
  }
  try {
    const parsed = validateDenoiseTaskDocument(
      JSON.parse(Deno.readTextFileSync(trimmed)),
    );
    return denoiseTaskToMarkdown(parsed);
  } catch {
    // Not a valid denoise task JSON file.
  }
  return null;
}

/**
 * Resolves a meld source to markdown content.
 * - GitHub issue URL: fetches issue and returns "# {title}\n\n{body}".
 * - Denoise task JSON file: materializes to markdown.
 * - Local path: reads file and returns contents.
 *
 * @param source - GitHub issue URL, path to a markdown file, or denoise task JSON
 * @returns Markdown content for the source
 * @throws Error if URL fetch fails or file cannot be read
 */
export async function resolveSource(source: string): Promise<string> {
  const trimmed = source.trim();
  if (trimmed === "") {
    return "";
  }
  if (isDenoiseTaskUrl(trimmed)) {
    const parsed = parseDenoiseTaskUrl(trimmed);
    if (!parsed) {
      throw new Error(`Invalid Denoise task URL: ${trimmed}`);
    }
    const token = await resolveGitHubToken();
    const ref = await fetchDenoiseTaskRefFromParsed(parsed, {
      githubToken: token,
    });
    if (ref.github_issue) {
      const issue = await fetchIssueFromUrl(ref.github_issue.url);
      return `# ${issue.title}\n\n${issue.body ?? ""}`.trim();
    }
    return denoiseTaskToMarkdown(
      validateDenoiseTaskDocument(ref.task_document),
    );
  }
  if (isGitHubIssueUrl(trimmed)) {
    const issue = await fetchIssueFromUrl(trimmed);
    return `# ${issue.title}\n\n${issue.body ?? ""}`.trim();
  }
  const denoise = tryDenoiseTaskJson(trimmed);
  if (denoise !== null) return denoise;
  return await Deno.readTextFile(trimmed);
}
