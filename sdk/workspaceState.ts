// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Workspace-local dn state under `.dn/` (tmp prompts, implement-result,
 * until verdicts). Distinct from the user home `~/.dn/` config directory.
 *
 * Older local compiles wrote a binary named `.dn` in the repo root. That
 * path collides with the state directory; {@link ensureWorkspaceStateDir}
 * migrates a leftover binary to `bin/dn` when needed.
 */

/** Relative directory for workspace-local dn state. */
export const WORKSPACE_STATE_DIRNAME = ".dn";

/** Local compile output path (repo-relative). */
export const LOCAL_COMPILE_BINARY_RELATIVE_PATH = "bin/dn";

/**
 * Absolute path to the workspace `.dn` state directory.
 */
export function workspaceStateDir(workspaceRoot: string): string {
  return `${workspaceRoot.replace(/\/+$/, "")}/${WORKSPACE_STATE_DIRNAME}`;
}

/**
 * Ensures the workspace `.dn/` directory exists.
 *
 * If a legacy compiled binary occupies `.dn`, it is moved to `bin/dn` (or
 * removed when `bin/dn` already exists) so the state directory can be
 * created.
 *
 * @returns Absolute path to the state directory
 */
export async function ensureWorkspaceStateDir(
  workspaceRoot: string,
): Promise<string> {
  const dir = workspaceStateDir(workspaceRoot);
  try {
    const st = await Deno.lstat(dir);
    if (st.isDirectory) {
      return dir;
    }
    if (st.isFile || st.isSymlink) {
      await migrateLegacyCompileBinary(workspaceRoot, dir);
    } else {
      throw new Error(
        `Workspace state path ${dir} exists but is not a directory.`,
      );
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  await Deno.mkdir(dir, { recursive: true });
  return dir;
}

async function migrateLegacyCompileBinary(
  workspaceRoot: string,
  legacyPath: string,
): Promise<void> {
  const root = workspaceRoot.replace(/\/+$/, "");
  const destDir = `${root}/bin`;
  const dest = `${destDir}/${
    LOCAL_COMPILE_BINARY_RELATIVE_PATH.split("/").pop()
  }`;
  await Deno.mkdir(destDir, { recursive: true });

  let destExists = false;
  try {
    await Deno.lstat(dest);
    destExists = true;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  if (destExists) {
    await Deno.remove(legacyPath);
    console.warn(
      `[dn] Removed legacy compile artifact at ${legacyPath} so .dn/ can hold workspace state (bin/dn already exists).`,
    );
    return;
  }

  await Deno.rename(legacyPath, dest);
  console.warn(
    `[dn] Moved legacy compile artifact ${legacyPath} → ${dest} so .dn/ can hold workspace state.`,
  );
}
