// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * **`dn sync`** — Sapling workflow to pull/rebase onto `main`, optionally
 * restack orphaned drafts, and push draft commits on the main-line stack.
 *
 * Mirrors the canonical steps documented under **Workflow: `make sync`** in
 * `AGENTS.md`. Sapling **`push`** uses remote credentials configured for the
 * repository (`gh auth`, credential helpers, or SSH); **`dn auth`** applies to
 * GitHub API callers, not directly to Sapling HTTPS push.
 */

import * as path from "@std/path";

const RESTACK_REVSET = "children(obsolete()) - obsolete()";
const PUSH_REVSET = "draft() & ancestors(.) & descendants(main)";

async function commandOutput(
  command: string | URL,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  const code = result.success ? 0 : result.code ?? 1;

  return { code, stdout, stderr };
}

/**
 * Runs **`sl root`** starting from **`candidateDir`** and returns the canonical
 * repository root path.
 *
 * @param candidateDir - Directory to probe (typically the current workspace)
 * @returns Absolute Sapling repo root from `sl root`
 * @throws Error when `sl` fails or emits an empty root
 */
async function saplingRepoRoot(candidateDir: string): Promise<string> {
  const { code, stdout, stderr } = await commandOutput(
    "sl",
    ["root"],
    candidateDir,
  );
  if (code !== 0) {
    throw new Error(
      `Not a Sapling checkout (failed to run 'sl root' from ${candidateDir}):\n${
        stderr.trim() ||
        stdout.trim() ||
        `exit ${code}`
      }`,
    );
  }
  const root = stdout.trim().split(/\r?\n/).find((l) => l.length > 0);
  if (!root) {
    throw new Error(
      `'sl root' returned no path (cwd hint: ${candidateDir})`,
    );
  }
  return path.resolve(root);
}

async function runInherited(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const status = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }).spawn().status;

  if (!status.success) {
    const code = typeof status.code === "number" ? status.code : 1;
    throw new Error(`${command} ${args.join(" ")} exited with code ${code}`);
  }
}

/**
 * Returns **`true`** when **`sl log --rev`** prints at least one revision line.
 */
async function revsetProducesCommits(
  repoRoot: string,
  revset: string,
): Promise<boolean> {
  const { code, stdout, stderr } = await commandOutput("sl", [
    "log",
    "--rev",
    revset,
    "-T",
    "{node}\n",
  ], repoRoot);

  if (code !== 0) {
    throw new Error(
      `'sl log' failed evaluating revset ${JSON.stringify(revset)}:${
        stderr.trim() ? `\n${stderr.trim()}` : ` (exit ${code})`
      }`,
    );
  }

  const firstLine = stdout.split(/\r?\n/).find((l) =>
    l.replace(/\s/g, "").length > 0
  );
  return firstLine !== undefined;
}

interface SyncParsedArgs {
  workspaceRootCandidate: string;
}

function parseSyncArgs(raw: string[]): SyncParsedArgs {
  let workspaceRootCandidate = Deno.cwd();

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "--help" || arg === "-h") {
      printSyncHelp();
      Deno.exit(0);
    }
    if (arg === "--workspace-root") {
      if (i + 1 >= raw.length) {
        throw new Error("--workspace-root requires a path");
      }
      workspaceRootCandidate = path.resolve(raw[++i]);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      throw new Error(
        `Unexpected argument: ${arg}\n(use --workspace-root <path> for the Sapling repo)`,
      );
    }
  }

  return { workspaceRootCandidate };
}

function printSyncHelp(): void {
  console.log(
    "dn sync — Rebase onto remote main; restack if needed; push drafts\n",
  );
  console.log(
    "Runs `make lint`, then Sapling pull/rebase onto main, conditional restack,",
  );
  console.log(
    "and `sl push --to main` only when drafts exist on the main-line stack.",
  );
  console.log(
    "Requires Sapling (`sl`), GNU/BSD make, and Deno (same prerequisites as make lint).\n",
  );
  console.log("Usage:");
  console.log("  dn sync [--workspace-root <path>]\n");
  console.log("Options:");
  console.log(
    "  --workspace-root <path>  Directory inside the Sapling repo (default: cwd)",
  );
  console.log("  --help, -h               Show this help\n");
}

/**
 * Executes the Sapling-aligned sync workflow.
 *
 * @param args — CLI tokens after **`sync`** (excluding global flags consumed by **`main`**)
 */
export async function handleSync(args: string[]): Promise<void> {
  const parsed = parseSyncArgs(args);

  console.log("[dn sync] resolving Sapling repo root...");
  const repoRoot = await saplingRepoRoot(parsed.workspaceRootCandidate);
  console.log(`[dn sync] repo root: ${repoRoot}`);

  console.log("[dn sync] running make lint...");
  await runInherited("make", ["lint"], repoRoot);

  console.log("[dn sync] sl pull --rebase -d main");
  await runInherited("sl", ["pull", "--rebase", "-d", "main"], repoRoot);

  const needsRestack = await revsetProducesCommits(repoRoot, RESTACK_REVSET);
  if (needsRestack) {
    console.log(
      `[dn sync] restacking (revset matched: ${RESTACK_REVSET})...`,
    );
    await runInherited("sl", ["restack"], repoRoot);
  } else {
    console.log("[dn sync] skipping restack (no obsolete children matched).");
  }

  const draftsToPublish = await revsetProducesCommits(repoRoot, PUSH_REVSET);
  if (draftsToPublish) {
    console.log(
      `[dn sync] pushing drafts on main lineage (revset ${PUSH_REVSET})...`,
    );
    await runInherited("sl", ["push", "--to", "main"], repoRoot);
  } else {
    console.log(
      "[dn sync] skipping push — no draft commits on this stack branch from main.",
    );
  }

  console.log("[dn sync] finished.");
}
