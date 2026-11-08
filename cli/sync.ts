// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * **`dn sync`** — Git and Sapling workflow to rebase onto remote trunk and
 * publish local commits.
 *
 * Default mode lands on remote **trunk**. With **`--pr`**, lifts local commits
 * onto a topic branch/bookmark, pushes to origin, and opens a GitHub pull
 * request (without pushing trunk).
 *
 * Optional quality gates come from `dn.json` `sync.preflight` ensure recipe
 * names. Repositories without that block run no gate before rebase.
 *
 * Sapling and Git use the credentials configured for their repository
 * remotes. **`dn auth`** applies to GitHub API callers, not VCS pushes.
 */

import * as path from "@std/path";
import { execRecipeArgv } from "./ensure.ts";
import { resolveDnConfig } from "../sdk/config/resolve.ts";
import type { DnEnsureConfig, DnSyncConfig } from "../sdk/config/types.ts";
import { createPR } from "../sdk/github/github.ts";
import {
  fetchIssueFromUrl,
  resolveIssueUrlInput,
} from "../sdk/github/issue.ts";
import type { IssueData } from "../sdk/github/issue.ts";
import { assertPublishAllowedInCi } from "../sdk/github/publish.ts";
import {
  generateBranchName,
  parseIssueNumberFromCommitSubject,
  promoteStackToTopicBranchForPr,
  promptForBranchName,
} from "../sdk/github/vcs.ts";
import { isUnattended } from "../sdk/github/output.ts";

const RESTACK_REVSET = "children(obsolete()) - obsolete()";
const DEFAULT_TRUNK_CANDIDATE = "main";

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

async function tryGitCommandOutput(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string } | null> {
  try {
    return await commandOutput("git", args, cwd);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
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
  let status: Deno.CommandStatus;
  try {
    status = await new Deno.Command(command, {
      args,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }).spawn().status;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${command} not found on PATH`);
    }
    throw error;
  }

  if (!status.success) {
    const code = typeof status.code === "number" ? status.code : 1;
    throw new Error(`${command} ${args.join(" ")} exited with code ${code}`);
  }
}

function pushRevset(trunk: string): string {
  return `draft() & ancestors(.) & descendants(${trunk})`;
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

async function saplingRevExists(
  repoRoot: string,
  rev: string,
): Promise<boolean> {
  const { code, stdout } = await commandOutput("sl", [
    "log",
    "--rev",
    rev,
    "-T",
    "{node}\n",
  ], repoRoot);
  return code === 0 && firstOutputLine(stdout) !== undefined;
}

async function gitRemoteExists(
  repoRoot: string,
  remote: string,
): Promise<boolean> {
  const result = await tryGitCommandOutput(
    ["remote", "get-url", remote],
    repoRoot,
  );
  return result !== null && result.code === 0 &&
    firstOutputLine(result.stdout) !== undefined;
}

async function listGitRemotes(repoRoot: string): Promise<string[]> {
  const result = await tryGitCommandOutput(["remote"], repoRoot);
  if (!result || result.code !== 0) {
    return [];
  }
  return result.stdout.trim().split(/\r?\n/).filter((line) => line.length > 0);
}

async function gitSymbolicHeadBranch(
  repoRoot: string,
  remote: string,
): Promise<string | undefined> {
  const result = await tryGitCommandOutput(
    ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`],
    repoRoot,
  );
  if (!result) {
    return undefined;
  }
  const ref = firstOutputLine(result.stdout);
  if (result.code !== 0 || !ref) {
    return undefined;
  }
  const prefix = `refs/remotes/${remote}/`;
  if (!ref.startsWith(prefix)) {
    return undefined;
  }
  const branch = ref.slice(prefix.length);
  return branch.length > 0 ? branch : undefined;
}

async function gitLocalBranchExists(
  repoRoot: string,
  branch: string,
): Promise<boolean> {
  const result = await tryGitCommandOutput(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    repoRoot,
  );
  return result !== null && result.code === 0;
}

/**
 * Prefers the remote tracked by local trunk, then `origin`, then the first
 * configured remote.
 */
async function resolveGitRemote(
  repoRoot: string,
  trunk: string,
): Promise<string> {
  const configured = await tryGitCommandOutput(
    ["config", "--get", `branch.${trunk}.remote`],
    repoRoot,
  );
  if (!configured) {
    throw new Error("git not found on PATH");
  }
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
  const remotes = await listGitRemotes(repoRoot);
  const first = remotes[0];
  if (first && await gitRemoteExists(repoRoot, first)) {
    return first;
  }
  throw new Error(
    `Git ${trunk} has no usable tracked remote and no origin remote is configured`,
  );
}

async function resolvePreferredGitRemote(
  repoRoot: string,
): Promise<string | undefined> {
  if (await gitRemoteExists(repoRoot, "origin")) {
    return "origin";
  }
  const remotes = await listGitRemotes(repoRoot);
  return remotes[0];
}

async function resolveTrunkName(
  repo: SyncRepo,
  syncConfig: DnSyncConfig | undefined,
): Promise<string> {
  if (syncConfig?.trunk) {
    return syncConfig.trunk;
  }

  const gitRemote = await resolvePreferredGitRemote(repo.root);
  if (gitRemote) {
    const fromHead = await gitSymbolicHeadBranch(repo.root, gitRemote);
    if (fromHead) {
      return fromHead;
    }
  }

  if (repo.vcs === "sapling") {
    if (await saplingRevExists(repo.root, DEFAULT_TRUNK_CANDIDATE)) {
      return DEFAULT_TRUNK_CANDIDATE;
    }
  } else if (await gitLocalBranchExists(repo.root, DEFAULT_TRUNK_CANDIDATE)) {
    return DEFAULT_TRUNK_CANDIDATE;
  }

  throw new Error(
    "Could not determine trunk branch. Set sync.trunk in dn.json",
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
  skipPreflight: boolean;
  openPr: boolean;
  issueInput?: string;
}

/** Parses `dn sync` CLI flags (exported for tests). */
export function parseSyncArgs(raw: string[]): SyncParsedArgs {
  let workspaceRootCandidate = Deno.cwd();
  let skipPreflight = false;
  let openPr = false;
  let issueInput: string | undefined;

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
    } else if (arg === "--skip-preflight") {
      skipPreflight = true;
    } else if (arg === "--pr") {
      openPr = true;
    } else if (arg === "--issue") {
      if (i + 1 >= raw.length) {
        throw new Error("--issue requires an issue number or URL");
      }
      issueInput = raw[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      throw new Error(
        `Unexpected argument: ${arg}\n(use --workspace-root <path> for the repository)`,
      );
    }
  }

  return { workspaceRootCandidate, skipPreflight, openPr, issueInput };
}

function printSyncHelp(): void {
  console.log(
    "dn sync — Rebase onto remote trunk and publish local commits\n",
  );
  console.log(
    "Default: trunk landing — rebase onto remote trunk and push to trunk.",
  );
  console.log(
    "With --pr: push a topic branch and open a pull request (does not push trunk).\n",
  );
  console.log(
    "Runs optional `sync.preflight` ensure recipes from dn.json, then detects",
  );
  console.log(
    "Sapling or Git and rebases onto remote trunk. Sapling also restacks",
  );
  console.log("obsolete descendants when needed.");
  console.log(
    "Pushes only when local commits remain after the rebase.\n",
  );
  console.log("Usage:");
  console.log("  dn sync [options]\n");
  console.log("Options:");
  console.log(
    "  --pr                     Publish via topic branch + GitHub PR (not trunk)",
  );
  console.log(
    "  --issue <number|url>     Issue for branch name and PR (auto from #N: commit when omitted)",
  );
  console.log(
    "  --workspace-root <path>  Directory inside the repository (default: cwd)",
  );
  console.log(
    "  --skip-preflight         Skip dn.json sync.preflight ensure recipes",
  );
  console.log("  --help, -h               Show this help\n");
}

function formatArgvForLog(argv: string[]): string {
  return argv.map((arg) => {
    if (/^[\w./:=+-]+$/.test(arg)) return arg;
    return JSON.stringify(arg);
  }).join(" ");
}

async function runSyncEnsurePreflight(
  repoRoot: string,
  recipeNames: string[] | undefined,
  ensure: DnEnsureConfig | undefined,
): Promise<void> {
  if (!recipeNames || recipeNames.length === 0) {
    console.log("[dn sync] no preflight configured.");
    return;
  }
  if (!ensure || Object.keys(ensure).length === 0) {
    throw new Error(
      `sync.preflight lists ${
        recipeNames.map((n) => JSON.stringify(n)).join(", ")
      } but dn.json has no ensure recipes`,
    );
  }
  for (const name of recipeNames) {
    const recipe = ensure[name];
    if (recipe === undefined) {
      const known = Object.keys(ensure).sort();
      const knownLabel = known.length === 0
        ? "none"
        : known.map((value) => JSON.stringify(value)).join(", ");
      throw new Error(
        `Unknown ensure recipe ${
          JSON.stringify(name)
        } in sync.preflight. Known recipes: ${knownLabel}`,
      );
    }
    console.log(
      `[dn sync] preflight ensure ${name}: ${formatArgvForLog(recipe.argv)}`,
    );
    const capture = await execRecipeArgv(recipe.argv, repoRoot);
    if (capture.code !== 0) {
      throw new Error(
        `sync preflight ensure ${
          JSON.stringify(name)
        } exited with code ${capture.code}`,
      );
    }
  }
}

async function rebaseSaplingOntoTrunk(
  repoRoot: string,
  trunk: string,
): Promise<void> {
  console.log(`[dn sync] sl pull --rebase -d ${trunk}`);
  await runInherited("sl", ["pull", "--rebase", "-d", trunk], repoRoot);

  if (await revsetProducesCommits(repoRoot, RESTACK_REVSET)) {
    console.log(`[dn sync] restacking (revset matched: ${RESTACK_REVSET})...`);
    await runInherited("sl", ["restack"], repoRoot);
  } else {
    console.log("[dn sync] skipping restack (no obsolete children matched).");
  }
}

async function syncSapling(repoRoot: string, trunk: string): Promise<void> {
  await rebaseSaplingOntoTrunk(repoRoot, trunk);

  const publishRevset = pushRevset(trunk);
  if (await revsetProducesCommits(repoRoot, publishRevset)) {
    console.log(
      `[dn sync] pushing drafts on ${trunk} lineage (revset ${publishRevset})...`,
    );
    await runInherited("sl", ["push", "--to", trunk], repoRoot);
  } else {
    console.log(
      `[dn sync] skipping push — no draft commits on this stack branch from ${trunk}.`,
    );
  }
}

async function syncGit(repoRoot: string, trunk: string): Promise<void> {
  const remote = await resolveGitRemote(repoRoot, trunk);
  console.log(`[dn sync] using Git remote: ${remote}`);
  console.log(`[dn sync] git fetch ${remote} ${trunk}`);
  await runInherited("git", ["fetch", remote, trunk], repoRoot);
  console.log("[dn sync] git rebase FETCH_HEAD");
  await runInherited("git", ["rebase", "FETCH_HEAD"], repoRoot);

  if (await gitHasCommitsToPublish(repoRoot)) {
    console.log(`[dn sync] pushing local commits to ${remote}/${trunk}...`);
    await runInherited("git", ["push", remote, `HEAD:${trunk}`], repoRoot);
  } else {
    console.log(
      `[dn sync] skipping push — no local commits ahead of remote ${trunk}.`,
    );
  }
}

async function latestGitCommitSubject(repoRoot: string): Promise<string> {
  const { code, stdout, stderr } = await commandOutput(
    "git",
    ["log", "-1", "--format=%s"],
    repoRoot,
  );
  if (code !== 0) {
    throw new Error(
      `'git log' failed reading latest commit:${
        stderr.trim() ? `\n${stderr.trim()}` : ` (exit ${code})`
      }`,
    );
  }
  return stdout.trim();
}

async function latestSaplingCommitSubject(repoRoot: string): Promise<string> {
  const { code, stdout, stderr } = await commandOutput("sl", [
    "log",
    "-r",
    ".",
    "-T",
    "{desc|firstline}",
  ], repoRoot);
  if (code !== 0) {
    throw new Error(
      `'sl log' failed reading latest commit:${
        stderr.trim() ? `\n${stderr.trim()}` : ` (exit ${code})`
      }`,
    );
  }
  return stdout.trim();
}

async function resolveSyncPrIssue(
  repo: SyncRepo,
  issueInput: string | undefined,
): Promise<IssueData> {
  if (issueInput) {
    const url = await resolveIssueUrlInput(issueInput);
    return await fetchIssueFromUrl(url);
  }
  const subject = repo.vcs === "sapling"
    ? await latestSaplingCommitSubject(repo.root)
    : await latestGitCommitSubject(repo.root);
  const issueNumber = parseIssueNumberFromCommitSubject(subject);
  if (issueNumber === null) {
    throw new Error(
      "Could not resolve a GitHub issue for --pr. Pass --issue <number|url> or land with a #N: commit subject prefix.",
    );
  }
  const url = await resolveIssueUrlInput(String(issueNumber), {
    allowBareNumber: true,
  });
  return await fetchIssueFromUrl(url);
}

function resolveTopicBranchName(
  issueData: IssueData,
  vcs: SyncVcs,
): string {
  const suggested = generateBranchName(issueData);
  if (isUnattended()) {
    return suggested;
  }
  return promptForBranchName(suggested, vcs);
}

async function syncSaplingPr(
  repoRoot: string,
  trunk: string,
  issueData: IssueData,
): Promise<void> {
  await rebaseSaplingOntoTrunk(repoRoot, trunk);

  const publishRevset = pushRevset(trunk);
  if (!(await revsetProducesCommits(repoRoot, publishRevset))) {
    console.log(
      `[dn sync] skipping PR — no draft commits on this stack branch from ${trunk}.`,
    );
    return;
  }

  const branchName = resolveTopicBranchName(issueData, "sapling");
  console.log(`[dn sync] promoting stack to bookmark ${branchName}...`);
  const gitContext = await promoteStackToTopicBranchForPr({
    repoRoot: repoRoot,
    vcs: "sapling",
    trunk,
    branchName,
    gitRemote: "origin",
  });

  const prUrl = await createPR(issueData, gitContext.branchName, "sapling") ??
    undefined;
  if (prUrl) {
    console.log(`[dn sync] pull request: ${prUrl}`);
  } else {
    console.log(
      "[dn sync] PR creation skipped; push output above may include a manual link.",
    );
  }
}

async function syncGitPr(
  repoRoot: string,
  trunk: string,
  issueData: IssueData,
): Promise<void> {
  const remote = await resolveGitRemote(repoRoot, trunk);
  console.log(`[dn sync] using Git remote: ${remote}`);
  console.log(`[dn sync] git fetch ${remote} ${trunk}`);
  await runInherited("git", ["fetch", remote, trunk], repoRoot);
  console.log("[dn sync] git rebase FETCH_HEAD");
  await runInherited("git", ["rebase", "FETCH_HEAD"], repoRoot);

  if (!(await gitHasCommitsToPublish(repoRoot))) {
    console.log(
      `[dn sync] skipping PR — no local commits ahead of remote ${trunk}.`,
    );
    return;
  }

  const branchName = resolveTopicBranchName(issueData, "git");
  console.log(`[dn sync] promoting stack to branch ${branchName}...`);
  const gitContext = await promoteStackToTopicBranchForPr({
    repoRoot: repoRoot,
    vcs: "git",
    trunk,
    branchName,
    gitRemote: remote,
  });

  const prUrl = await createPR(issueData, gitContext.branchName, "git") ??
    undefined;
  if (prUrl) {
    console.log(`[dn sync] pull request: ${prUrl}`);
  } else {
    console.log(
      "[dn sync] PR creation skipped; push output above may include a manual link.",
    );
  }
}

/** Executes the VCS-aligned sync workflow. */
export async function handleSync(args: string[]): Promise<void> {
  const parsed = parseSyncArgs(args);

  console.log("[dn sync] resolving repository root...");
  const repo = await detectSyncRepo(parsed.workspaceRootCandidate);
  console.log(`[dn sync] detected ${repo.vcs}; repo root: ${repo.root}`);

  const config = await resolveDnConfig({ repoRoot: repo.root });
  const trunk = await resolveTrunkName(repo, config.sync);
  console.log(`[dn sync] trunk: ${trunk}`);

  if (parsed.skipPreflight) {
    console.log("[dn sync] skipping preflight (--skip-preflight).");
  } else {
    await runSyncEnsurePreflight(
      repo.root,
      config.sync?.preflight,
      config.ensure,
    );
  }

  if (parsed.openPr) {
    assertPublishAllowedInCi("pr");
    const issueData = await resolveSyncPrIssue(repo, parsed.issueInput);
    if (repo.vcs === "sapling") {
      await syncSaplingPr(repo.root, trunk, issueData);
    } else {
      await syncGitPr(repo.root, trunk, issueData);
    }
  } else if (repo.vcs === "sapling") {
    await syncSapling(repo.root, trunk);
  } else {
    await syncGit(repo.root, trunk);
  }

  console.log("[dn sync] finished.");
}
