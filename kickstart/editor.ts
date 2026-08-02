// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { isUnattended } from "../sdk/github/output.ts";

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
  const editor = Deno.env.get("EDITOR")?.trim();
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
 * Reviews a plan in the configured editor when the process is attended.
 *
 * @param filePath - Plan file to review
 * @returns Whether an editor was configured and launched
 */
export async function reviewPlanInEditor(filePath: string): Promise<boolean> {
  if (isUnattended()) {
    return false;
  }
  return await openInEditor(filePath);
}
