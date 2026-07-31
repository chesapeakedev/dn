// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Read kickstart system prompts embedded via `deno compile --include`.
 *
 * This module must live under `kickstart/` so `import.meta.dirname` matches the
 * `--include` layout. Compiled Deno VFS rejects `".."` path traversal
 * (denoland/deno#29907), so callers outside `kickstart/` must use this helper
 * instead of relative `../kickstart/...` strings.
 */

function kickstartDir(): string {
  const url = new URL(import.meta.url);
  if (url.protocol === "file:") {
    return new URL(".", url).pathname;
  }
  return new URL(".", import.meta.url).pathname;
}

/**
 * Reads an included kickstart prompt by basename (e.g. `system.prompt.land.md`).
 *
 * @param filename - Prompt file name under `kickstart/`
 * @param workspaceRoot - Optional consumer workspace for source-tree fallback
 * @returns Prompt file contents
 */
export async function readIncludedSystemPrompt(
  filename: string,
  workspaceRoot?: string,
): Promise<string> {
  const candidates: string[] = [];

  if (typeof import.meta.dirname !== "undefined") {
    candidates.push(`${import.meta.dirname}/${filename}`);
  }

  const dir = kickstartDir();
  candidates.push(`${dir}/${filename}`);

  if (workspaceRoot) {
    candidates.push(`${workspaceRoot}/kickstart/${filename}`);
    candidates.push(`${workspaceRoot}/${filename}`);
  }

  for (const path of candidates) {
    try {
      return await Deno.readTextFile(path);
    } catch {
      // try next
    }
  }

  throw new Error(
    `System prompt not found: ${filename}. Run from dn repo or recompile with --include.`,
  );
}
