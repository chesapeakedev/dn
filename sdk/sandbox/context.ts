// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { SandboxExecContext } from "./types.ts";

let currentContext: SandboxExecContext | null = null;

export function setCurrentSandboxContext(
  ctx: SandboxExecContext | null,
): void {
  currentContext = ctx;
}

export function getCurrentSandboxContext(): SandboxExecContext | null {
  return currentContext;
}

export function isSandboxActive(): boolean {
  return currentContext !== null && currentContext.provider !== "none";
}

export function getWorkspaceTmpDir(workspaceRoot: string): string {
  return `${workspaceRoot}/.dn/tmp`;
}

/** Temp dir under workspace when sandbox is active; system /tmp otherwise. */
export async function createRunTmpDir(
  workspaceRoot: string,
  prefix: string,
): Promise<string> {
  if (isSandboxActive()) {
    const baseDir = getWorkspaceTmpDir(workspaceRoot);
    await Deno.mkdir(baseDir, { recursive: true });
    return await Deno.makeTempDir({ dir: baseDir, prefix });
  }
  return await Deno.makeTempDir({ prefix });
}
