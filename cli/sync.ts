// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * **`dn sync`** — Git and Sapling workflow to rebase onto remote `main` and
 * publish commits on the main-line stack.
 *
 * Sapling and Git use the credentials configured for their repository
 * remotes. **`dn auth`** applies to GitHub API callers, not VCS pushes.
 */

import * as path from "@std/path";

const RESTACK_REVSET = "children(obsolete()) - obsolete()";
const PUSH_REVSET = "draft() & ancestors(.) & descendants(main)";

type SyncVcs = "git" | "sapling";

interface SyncRepo {
  root: string;
  vcs: SyncVcs;
}

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

function firstOutputLine(output: string): string | undefined {
  return output.trim().split(/\r?\n/).find((line) => line.length > 0);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await Deno.stat(candidate);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/** Detects the repository root, preferring Sapling in dual-compatible repos. */
async function detectSyncRepo(candidateDir: string): Promise<SyncRepo> {
  try {
    const sapling = await commandOutput("sl", ["root"], candidateDir);
    const root = firstOutputLine(sapling.stdout);
    // Sapling can operate directly on plain Git checkouts. Require native
    // checkout metadata so an installed `sl` does not capture every Git repo.
    if (
      sapling.code === 0 && root && await pathExists(path.join(root, ".sl"))
    ) {
      return { root: path.resolve(root), vcs: "sapling" };
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  try {
    const git = await commandOutput(
      "git",
      ["rev-parse", "--show-toplevel"],
      candidateDir,
    );
    const root = firstOutputLine(git.stdout);
    if (git.code === 0 && root) {
      return { root: path.resolve(root), vcs: "git" };
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  throw new Error(
    `Not a Sapling or Git checkout (starting from ${candidateDir})`,
  );
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

/** Returns `true` when `sl log --rev` prints at least one revision line. */
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

  return firstOutputLine(stdout) !== undefined;
}

async function gitRemoteExists(
  repoRoot: string,
  remote: string,
): Promise<boolean> {
  const result = await commandOutput(
    "git",
    ["remote", "get-url", remote],
    repoRoot,
  );
  return result.code === 0 && firstOutputLine(result.stdout) !== undefined;
}

/** Resolves the remote tracked by local `main`, falling back to `origin`. */
async function resolveGitRemote(repoRoot: string): Promise<string> {
  const configured = await commandOutput(
    "git",
    ["config", "--get", "branch.main.remote"],
    repoRoot,
  );
  const trackedRemote = firstOutputLine(configured.stdout);
  if (
    configured.code === 0 && trackedRemote && trackedRemote !== "." &&
    await gitRemoteExists(repoRoot, trackedRemote)
  ) {
    return trackedRemote;
  }
  if (await gitRemoteExists(repoRoot, "origin")) {
    return "origin";
  }
  throw new Error(
    "Git main has no usable tracked remote and no origin remote is configured",
  );
}

async function gitHasCommitsToPublish(repoRoot: string): Promise<boolean> {
  const { code, stdout, stderr } = await commandOutput(
    "git",
    ["rev-list", "--count", "FETCH_HEAD..HEAD"],
    repoRoot,
  );
  if (code !== 0) {
    throw new Error(
      `'git rev-list' failed checking commits to publish:${
        stderr.trim() ? `\n${stderr.trim()}` : ` (exit ${code})`
      }`,
    );
  }
  const count = Number.parseInt(stdout.trim(), 10);
  if (!Number.isInteger(count)) {
    throw new Error(
      `'git rev-list' returned an invalid count: ${stdout.trim()}`,
    );
  }
  return count > 0;
}

interface SyncParsedArgs {
  workspaceRootCandidate: string;
  skipLint: boolean;
}

function parseSyncArgs(raw: string[]): SyncParsedArgs {
  let workspaceRootCandidate = Deno.cwd();
  let skipLint = false;

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
    } else if (arg === "--skip-lint") {
      skipLint = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      throw new Error(
        `Unexpected argument: ${arg}\n(use --workspace-root <path> for the repository)`,
      );
    }
  }

  return { workspaceRootCandidate, skipLint };
}

function printSyncHelp(): void {
  console.log("dn sync — Rebase onto remote main and publish local commits\n");
  console.log(
    "Runs `make lint` unless skipped, then auto-detects Sapling or Git and rebases onto",
  );
  console.log(
    "remote main. Sapling also restacks obsolete descendants when needed.",
  );
  console.log(
    "Pushes only when local commits remain after the rebase.\n",
  );
  console.log("Usage:");
  console.log("  dn sync [--workspace-root <path>]\n");
  console.log("Options:");
  console.log(
    "  --workspace-root <path>  Directory inside the repository (default: cwd)",
  );
  console.log(
    "  --skip-lint              Skip `make lint` (used by `make sync`)",
  );
  console.log("  --help, -h               Show this help\n");
}

async function syncSapling(repoRoot: string): Promise<void> {
  console.log("[dn sync] sl pull --rebase -d main");
  await runInherited("sl", ["pull", "--rebase", "-d", "main"], repoRoot);

  if (await revsetProducesCommits(repoRoot, RESTACK_REVSET)) {
    console.log(`[dn sync] restacking (revset matched: ${RESTACK_REVSET})...`);
    await runInherited("sl", ["restack"], repoRoot);
  } else {
    console.log("[dn sync] skipping restack (no obsolete children matched).");
  }

  if (await revsetProducesCommits(repoRoot, PUSH_REVSET)) {
    console.log(
      `[dn sync] pushing drafts on main lineage (revset ${PUSH_REVSET})...`,
    );
    await runInherited("sl", ["push", "--to", "main"], repoRoot);
  } else {
    console.log(
      "[dn sync] skipping push — no draft commits on this stack branch from main.",
    );
  }
}

async function syncGit(repoRoot: string): Promise<void> {
  const remote = await resolveGitRemote(repoRoot);
  console.log(`[dn sync] using Git remote: ${remote}`);
  console.log(`[dn sync] git fetch ${remote} main`);
  await runInherited("git", ["fetch", remote, "main"], repoRoot);
  console.log("[dn sync] git rebase FETCH_HEAD");
  await runInherited("git", ["rebase", "FETCH_HEAD"], repoRoot);

  if (await gitHasCommitsToPublish(repoRoot)) {
    console.log(`[dn sync] pushing local commits to ${remote}/main...`);
    await runInherited("git", ["push", remote, "HEAD:main"], repoRoot);
  } else {
    console.log(
      "[dn sync] skipping push — no local commits ahead of remote main.",
    );
  }
}

/** Executes the VCS-aligned sync workflow. */
export async function handleSync(args: string[]): Promise<void> {
  const parsed = parseSyncArgs(args);

  console.log("[dn sync] resolving repository root...");
  const repo = await detectSyncRepo(parsed.workspaceRootCandidate);
  console.log(`[dn sync] detected ${repo.vcs}; repo root: ${repo.root}`);

  if (parsed.skipLint) {
    console.log("[dn sync] skipping make lint (--skip-lint).");
  } else {
    console.log("[dn sync] running make lint...");
    await runInherited("make", ["lint"], repo.root);
  }

  if (repo.vcs === "sapling") {
    await syncSapling(repo.root);
  } else {
    await syncGit(repo.root);
  }

  console.log("[dn sync] finished.");
}
