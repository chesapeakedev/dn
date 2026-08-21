// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { formatInfo, isUnattended } from "./output.ts";

/** Environment variables that should not be exposed to an interactive editor. */
const EDITOR_SECRET_ENV_KEYS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_CLIENT_SECRET",
  "AZURE_ACCESS_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "CURSOR_API_KEY",
  "DANGEROUS_GITHUB_TOKEN",
  "DATABASE_URL",
  "DN_PROGRESS_TOKEN",
  "EXE_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "NPM_TOKEN",
  "SLACK_TOKEN",
];

/**
 * Options for reviewing in-memory or on-disk agent draft text.
 */
export interface ReviewTextInEditorOptions {
  /** Draft content produced by an agent */
  content: string;
  /**
   * Existing draft path to open in place. When omitted, a temporary markdown
   * file is created and removed after review.
   */
  path?: string;
}

function editorCommand(): string | undefined {
  const editor = Deno.env.get("EDITOR")?.trim();
  return editor || undefined;
}

function canReviewInEditor(): boolean {
  return !isUnattended() && editorCommand() !== undefined;
}

/**
 * Opens a file with the command configured by `EDITOR`.
 *
 * The editor command may contain arguments, for example `code --wait` or
 * `hunk diff --`. The promise resolves after the editor exits and rejects if
 * the editor cannot be started or exits unsuccessfully.
 *
 * @param filePath - File to open in the configured editor
 * @returns Whether an editor was configured and launched
 */
export async function openInEditor(filePath: string): Promise<boolean> {
  const editor = editorCommand();
  if (!editor) {
    return false;
  }

  const absolutePath = await Deno.realPath(filePath).catch(() => filePath);

  // `eval` preserves arguments in EDITOR while keeping the file path as a
  // quoted positional parameter. EDITOR is intentionally a user-controlled
  // shell command, matching the convention used by git and dn tidy.
  const editorEnvironment = Deno.env.toObject();
  for (const key of EDITOR_SECRET_ENV_KEYS) {
    delete editorEnvironment[key];
  }

  const unsetSecretKeys = EDITOR_SECRET_ENV_KEYS.join(" ");
  const command = new Deno.Command("sh", {
    args: [
      "-c",
      `unset ${unsetSecretKeys}; eval "exec $EDITOR \\\"\\$1\\\""`,
      "_",
      absolutePath,
    ],
    env: editorEnvironment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await command.output();
  if (!result.success) {
    throw new Error(`Editor exited with code ${result.code}`);
  }
  return true;
}

/**
 * Reviews a file in the configured editor when the process is attended.
 *
 * Prints a one-line instruction before launching. Unattended runs, CI,
 * non-TTY sessions, and an unset `EDITOR` skip the editor.
 *
 * @param filePath - Draft file to review
 * @returns Whether an editor was configured and launched
 */
export async function reviewInEditor(filePath: string): Promise<boolean> {
  if (!canReviewInEditor()) {
    return false;
  }
  console.log(
    formatInfo(
      "Opening in $EDITOR for review. Close to continue; a non-zero exit aborts.",
    ),
  );
  return await openInEditor(filePath);
}

/**
 * Reviews agent-generated text in the configured editor and returns the result.
 *
 * When `path` is set, that file is overwritten with `content`, opened, then
 * re-read. Otherwise a temporary `.md` file is used. Unattended runs and an
 * unset `EDITOR` return `content` unchanged. Markdown headings are preserved.
 *
 * @param options - Draft content and optional persist path
 * @returns Text after review, or the original content when the editor is skipped
 */
export async function reviewTextInEditor(
  options: ReviewTextInEditorOptions,
): Promise<string> {
  if (!canReviewInEditor()) {
    return options.content;
  }

  let filePath = options.path;
  let tempDir: string | undefined;
  try {
    if (!filePath) {
      tempDir = await Deno.makeTempDir({ prefix: "dn-editor-review-" });
      filePath = `${tempDir}/draft.md`;
    }
    await Deno.writeTextFile(filePath, options.content);
    await reviewInEditor(filePath);
    return await Deno.readTextFile(filePath);
  } finally {
    if (tempDir) {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
