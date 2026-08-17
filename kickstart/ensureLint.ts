// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Kickstart lint phase: run `dn.json` `ensure.lint` with the fixer agent.
 *
 * Commands come from the named recipe, not from guessing `deno fmt` or
 * `npm run lint`. Kickstart never runs `ensure.tests`.
 */

import {
  execRecipeArgv,
  isEnsureActive,
  runEnsureRecipe,
  type RunEnsureRecipeOptions,
} from "../cli/ensure.ts";
import { resolveDnConfig } from "../sdk/config/resolve.ts";
import type { DnEnsureConfig, DnEnsureRecipe } from "../sdk/config/types.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import {
  getCurrentSandboxContext,
  isSandboxActive,
  translateSandboxCwd,
} from "../sdk/sandbox/mod.ts";

/** Recipe name kickstart uses for fmt/lint/typecheck. */
export const KICKSTART_ENSURE_LINT_RECIPE = "lint";

/** Result of the kickstart lint phase. */
export type KickstartEnsureLintOutcome =
  | { status: "skipped"; reason: "missing_recipe" }
  | { status: "passed" }
  | { status: "failed"; code: number };

/** Dependencies for {@link runKickstartEnsureLint}, injectable in tests. */
export interface RunKickstartEnsureLintOptions {
  /** Repository root that contains `dn.json`. */
  workspaceRoot: string;
  /** Agent harness used by the ensure fixer loop. */
  agent: AgentHarness;
  /** Override config resolution. */
  resolveConfig?: (opts: {
    repoRoot: string;
  }) => Promise<{ ensure?: DnEnsureConfig }>;
  /** Override the ensure runner. */
  runRecipe?: typeof runEnsureRecipe;
  /** Nested-ensure passthrough (defaults to {@link isEnsureActive}). */
  nested?: boolean;
  /** Override argv execution (sandbox-aware by default). */
  exec?: RunEnsureRecipeOptions["exec"];
}

/**
 * Executes recipe argv inside the active sandbox when kickstart is sandboxed,
 * otherwise on the host.
 */
export async function sandboxAwareEnsureExec(
  argv: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (isSandboxActive()) {
    const ctx = getCurrentSandboxContext();
    if (ctx) {
      const result = await ctx.runner.exec(ctx.handle, argv, {
        cwd: translateSandboxCwd(cwd),
      });
      return {
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
  }
  return execRecipeArgv(argv, cwd);
}

function lintRecipe(
  ensure: DnEnsureConfig | undefined,
): DnEnsureRecipe | undefined {
  return ensure?.[KICKSTART_ENSURE_LINT_RECIPE];
}

/**
 * Runs `ensure.lint` with the fixer agent. Skips when the recipe is absent.
 * Does not run tests.
 */
export async function runKickstartEnsureLint(
  options: RunKickstartEnsureLintOptions,
): Promise<KickstartEnsureLintOutcome> {
  const resolveConfig = options.resolveConfig ?? resolveDnConfig;
  const runRecipe = options.runRecipe ?? runEnsureRecipe;
  const nested = options.nested ?? isEnsureActive();
  const config = await resolveConfig({ repoRoot: options.workspaceRoot });
  const recipe = lintRecipe(config.ensure);
  if (recipe === undefined) {
    return { status: "skipped", reason: "missing_recipe" };
  }
  const result = await runRecipe({
    name: KICKSTART_ENSURE_LINT_RECIPE,
    recipe,
    workspaceRoot: options.workspaceRoot,
    noFix: false,
    nested,
    agent: options.agent,
    exec: options.exec ?? sandboxAwareEnsureExec,
  });
  if (result.code === 0) {
    return { status: "passed" };
  }
  return { status: "failed", code: result.code };
}

/** Error thrown when kickstart lint remains failing after the fixer loop. */
export function kickstartEnsureLintFailureMessage(code: number): string {
  return (
    `ensure lint failed with exit code ${code}. ` +
    "Kickstart will not open a PR or leave work ready to land until lint passes."
  );
}
