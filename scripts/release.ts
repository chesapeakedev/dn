// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommitEntry {
  node: string;
  subject: string;
}

interface GitHubRef {
  object?: {
    sha?: unknown;
    type?: unknown;
  };
}

interface GitHubTag {
  object?: {
    sha?: unknown;
  };
}

interface ReleaseOptions {
  dryRun: boolean;
  previousReleaseVersion?: string;
  version?: string;
}

function parseArgs(args: string[]): ReleaseOptions {
  let dryRun = false;
  let previousReleaseVersion: string | undefined;
  let version: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--version") {
      version = args[++index];
      if (!version) {
        throw new Error("--version requires a semantic version");
      }
    } else if (arg === "--previous-release-version") {
      previousReleaseVersion = args[++index];
      if (!previousReleaseVersion) {
        throw new Error(
          "--previous-release-version requires a semantic version",
        );
      }
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, previousReleaseVersion, version };
}

function showHelp(): void {
  console.log("release.ts - Run the dn release workflow\n");
  console.log("Usage:");
  console.log(
    "  deno run --allow-read --allow-write --allow-run --allow-env scripts/release.ts [--version <version>] [--dry-run]",
  );
  console.log("\nOptions:");
  console.log("  --version <version>  Release an explicit semantic version");
  console.log(
    "  --previous-release-version <version>  Use an explicit prior release boundary",
  );
  console.log(
    "  --dry-run            Preview notes without changing files; still runs",
  );
  console.log(
    "                       `deno publish --dry-run` and `make skill_goldens`",
  );
}

// utility function to run shell command
async function runCommand(args: string[]): Promise<CommandResult> {
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();

  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function runChecked(args: string[]): Promise<string> {
  const result = await runCommand(args);
  if (result.code !== 0) {
    const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean)
      .join("\n");
    throw new Error(`Command failed: ${args.join(" ")}\n${output}`);
  }
  return result.stdout;
}

async function runInteractive(args: string[]): Promise<void> {
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  if (code !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}`);
  }
}

export function parseSaplingLog(output: string): CommitEntry[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("watchman sockpath is set as "))
    .map((line) => {
      const [node, ...subjectParts] = line.split("\t");
      return { node, subject: subjectParts.join("\t") };
    })
    .filter((entry) => entry.node && entry.subject);
}

export function findPreviousReleaseCommit(
  commits: CommitEntry[],
  version: string,
): CommitEntry | null {
  const prefix = `${version}`;
  return commits.find((commit) => commit.subject.startsWith(prefix)) ?? null;
}

export function bumpPatchVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  const [major, minor, patch] = parts.map((part) => Number(part));
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    major < 0 ||
    minor < 0 ||
    patch < 0
  ) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  return `${major}.${minor}.${patch + 1}`;
}

export function validateReleaseVersion(
  currentVersion: string,
  releaseVersion: string,
): string {
  const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const currentMatch = currentVersion.match(semanticVersion);
  const releaseMatch = releaseVersion.match(semanticVersion);
  if (!currentMatch || !releaseMatch) {
    throw new Error(`Invalid semantic version: ${releaseVersion}`);
  }

  const current = currentMatch.slice(1).map(Number);
  const release = releaseMatch.slice(1).map(Number);
  const isNewer = release.some((part, index) =>
    part > current[index] &&
    release.slice(0, index).every((value, prefix) => value === current[prefix])
  );
  if (!isNewer) {
    throw new Error(
      `Release version ${releaseVersion} must be newer than ${currentVersion}`,
    );
  }

  return releaseVersion;
}

export function validateSemanticVersion(version: string): string {
  const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!semanticVersion.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  return version;
}

export function formatReleaseNotes(
  previousVersion: string,
  commits: CommitEntry[],
): string {
  const bullets = commits.map((commit) => `- ${commit.subject}`);
  return [`## Changes since ${previousVersion}`, "", ...bullets, ""].join(
    "\n",
  );
}

export function formatCommitMessage(
  newVersion: string,
  previousVersion: string,
  commits: CommitEntry[],
): string {
  const releaseNotes = formatReleaseNotes(previousVersion, commits).trimEnd();
  return `${newVersion}: release updates\n\n${releaseNotes}\n`;
}

async function readCurrentVersion(): Promise<string> {
  const configText = await Deno.readTextFile("deno.json");
  const config = JSON.parse(configText) as { version?: unknown };
  if (typeof config.version !== "string") {
    throw new Error("deno.json must contain a string version field");
  }
  return config.version;
}

async function assertCleanWorkingCopy(): Promise<void> {
  const status = await runChecked(["sl", "status"]);
  if (status.trim()) {
    throw new Error(
      `Working copy must be clean before release:\n${status.trim()}`,
    );
  }
}

async function assertOnlyVersionChanged(): Promise<void> {
  const status = await runChecked(["sl", "status"]);
  const lines = status.split("\n").map((line) => line.trim()).filter(Boolean);
  const allowed = lines.length === 1 && lines[0] === "M deno.json";
  if (!allowed) {
    throw new Error(
      `Expected only deno.json to be modified after validation:\n${
        status.trim() || "(no changes)"
      }`,
    );
  }
}

async function listAncestorCommits(): Promise<CommitEntry[]> {
  const output = await runChecked([
    "sl",
    "log",
    "-r",
    "sort(ancestors(.), -rev)",
    "-T",
    "{node|short}\t{desc|firstline}\\n",
  ]);
  return parseSaplingLog(output);
}

async function listCommitsSince(previousNode: string): Promise<CommitEntry[]> {
  const output = await runChecked([
    "sl",
    "log",
    "-r",
    `descendants(${previousNode}) & ancestors(.) - ${previousNode}`,
    "-T",
    "{node|short}\t{desc|firstline}\\n",
  ]);
  return parseSaplingLog(output);
}

/** Command used to validate the JSR package graph before a GitHub release. */
export const JSR_PUBLISH_DRY_RUN_ARGS = [
  "deno",
  "publish",
  "--dry-run",
] as const;

/** Regenerates checked-in dn harness skills; release fails if this rewrites files. */
export const SKILL_GOLDENS_ARGS = ["make", "skill_goldens"] as const;

/**
 * Formats a failed `deno publish --dry-run` so the operator knows to fix the
 * JSR graph before creating a GitHub release for the same version.
 */
export function formatJsrPublishDryRunError(output: string): string {
  const details = output.trim() || "(no output)";
  return [
    "JSR publish dry-run failed. Fix the package graph before creating a GitHub release.",
    "GitHub and JSR share the deno.json version, so a later `make publish` cannot recover a version that already shipped to GitHub.",
    details,
  ].join("\n");
}

/**
 * Formats a dirty tree after `make skill_goldens` so the operator commits the
 * regenerated files before `make sync` can publish trunk.
 */
export function formatSkillGoldensDriftError(status: string): string {
  const details = status.trim() || "(no status output)";
  return [
    "Checked-in skill goldens drifted from cli/init-agents.ts.",
    "Commit the `make skill_goldens` output before release or sync.",
    details,
  ].join("\n");
}

async function assertJsrPublishReady(): Promise<void> {
  console.log("Checking JSR package graph (deno publish --dry-run)...");
  const result = await runCommand([...JSR_PUBLISH_DRY_RUN_ARGS]);
  if (result.code !== 0) {
    const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean)
      .join("\n");
    throw new Error(formatJsrPublishDryRunError(output));
  }
  console.log("JSR publish dry-run succeeded.");
}

async function assertSkillGoldensCurrent(): Promise<void> {
  console.log("Checking skill goldens (make skill_goldens)...");
  await runInteractive([...SKILL_GOLDENS_ARGS]);
  const status = await runChecked(["sl", "status"]);
  if (status.trim()) {
    throw new Error(formatSkillGoldensDriftError(status));
  }
  console.log("Skill goldens are current.");
}

export function repositoryFromRemoteUrl(remote: string): string | undefined {
  const match = remote.trim().match(
    /(?:github\.com[:/]|git@github\.com:)([^/]+)\/([^/.]+?)(?:\.git)?$/i,
  );
  if (!match) return undefined;
  return `${match[1]}/${match[2]}`;
}

async function resolveRepositoryFromSapling(): Promise<string | undefined> {
  const result = await runCommand(["sl", "config", "paths.default"]);
  if (result.code !== 0) return undefined;
  return repositoryFromRemoteUrl(result.stdout);
}

async function resolveRepository(): Promise<string> {
  const discovered = await runCommand([
    "gh",
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  if (discovered.code === 0) {
    return discovered.stdout.trim();
  }

  // Sapling checkouts often lack a Git working tree that `gh` can discover.
  const fromSapling = await resolveRepositoryFromSapling();
  if (!fromSapling) {
    const output = [discovered.stderr.trim(), discovered.stdout.trim()].filter(
      Boolean,
    ).join("\n");
    throw new Error(
      `Command failed: gh repo view --json nameWithOwner --jq .nameWithOwner${
        output ? `\n${output}` : ""
      }`,
    );
  }

  return (await runChecked([
    "gh",
    "repo",
    "view",
    fromSapling,
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ])).trim();
}

async function resolveReleaseCommit(version: string): Promise<CommitEntry> {
  const repository = await resolveRepository();
  const tagName = `v${version}`;

  // Verify the release exists before resolving its tag. This avoids silently
  // using a similarly named tag when recovering from a failed release.
  await runChecked(["gh", "release", "view", tagName, "--repo", repository]);
  const ref = JSON.parse(
    await runChecked([
      "gh",
      "api",
      `repos/${repository}/git/ref/tags/${tagName}`,
    ]),
  ) as GitHubRef;
  const sha = ref.object?.sha;
  const type = ref.object?.type;
  if (typeof sha !== "string" || typeof type !== "string") {
    throw new Error(`GitHub returned an invalid tag reference for ${tagName}`);
  }

  let commitNode = sha;
  if (type === "tag") {
    const tag = JSON.parse(
      await runChecked([
        "gh",
        "api",
        `repos/${repository}/git/tags/${sha}`,
      ]),
    ) as GitHubTag;
    if (typeof tag.object?.sha !== "string") {
      throw new Error(
        `GitHub returned an invalid annotated tag for ${tagName}`,
      );
    }
    commitNode = tag.object.sha;
  }

  const commit = (await listAncestorCommits()).find((entry) =>
    commitNode.startsWith(entry.node) || entry.node.startsWith(commitNode)
  );
  if (!commit) {
    throw new Error(
      `Release ${tagName} points to ${commitNode}, which is not an ancestor of the current checkout`,
    );
  }
  return commit;
}

function fallbackUserFacingCommits(commits: CommitEntry[]): CommitEntry[] {
  const internalSubject =
    /^(?:merge |release\b|chore(?:\([^)]*\))?:|test(?:\([^)]*\))?:)/i;
  return commits.filter((commit) =>
    !internalSubject.test(commit.subject.trim())
  );
}

function parseSelectedCommitNodes(output: string): Set<string> | null {
  const matches = [...output.matchAll(/\[[\s\S]*?\]/g)];
  for (const match of matches.reverse()) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (
        Array.isArray(parsed) &&
        parsed.every((node): node is string => typeof node === "string")
      ) {
        return new Set(parsed);
      }
    } catch {
      // Try another JSON-looking section in the model response.
    }
  }
  return null;
}

async function filterUserFacingCommits(
  commits: CommitEntry[],
): Promise<CommitEntry[]> {
  const model = Deno.env.get("RELEASE_NOTES_MODEL")?.trim() ||
    "opencode/ling-3.0-flash-free";
  if (model.toLowerCase() === "none") return fallbackUserFacingCommits(commits);

  const prompt = [
    "Select the commits that describe user-visible changes for release notes.",
    "Exclude merges, release/version bumps, tests, CI, refactors, and internal maintenance.",
    "Return ONLY a JSON array containing the commit IDs you selected.",
    "Commits:",
    ...commits.map((commit) => `${commit.node}\t${commit.subject}`),
  ].join("\n");
  let result: CommandResult;
  try {
    result = await runCommand([
      "opencode",
      "run",
      "--model",
      model,
      "--format",
      "default",
      prompt,
    ]);
  } catch {
    console.warn(
      "Release notes model unavailable; using commit subjects instead.",
    );
    return fallbackUserFacingCommits(commits);
  }
  if (result.code !== 0) {
    console.warn(
      "Release notes model unavailable; using commit subjects instead.",
    );
    return fallbackUserFacingCommits(commits);
  }

  const selected = parseSelectedCommitNodes(result.stdout);
  if (!selected) {
    console.warn(
      "Release notes model returned invalid output; using commit subjects instead.",
    );
    return fallbackUserFacingCommits(commits);
  }
  return commits.filter((commit) => selected.has(commit.node));
}

async function writeTempFile(prefix: string, content: string): Promise<string> {
  const path = await Deno.makeTempFile({ prefix, suffix: ".md" });
  await Deno.writeTextFile(path, content);
  return path;
}

async function runRelease(options: ReleaseOptions): Promise<void> {
  await assertCleanWorkingCopy();
  await assertJsrPublishReady();
  await assertSkillGoldensCurrent();

  const previousVersion = await readCurrentVersion();
  const newVersion = options.version
    ? validateReleaseVersion(previousVersion, options.version)
    : bumpPatchVersion(previousVersion);
  const previousReleaseVersion = options.previousReleaseVersion
    ? validateSemanticVersion(options.previousReleaseVersion)
    : previousVersion;
  const previousRelease = await resolveReleaseCommit(previousReleaseVersion);

  const commits = await listCommitsSince(previousRelease.node);
  if (commits.length === 0) {
    throw new Error(
      `No commits found since ${previousRelease.node} (${previousRelease.subject})`,
    );
  }

  const userFacingCommits = await filterUserFacingCommits(commits);
  if (userFacingCommits.length === 0) {
    throw new Error("No user-facing commits found since the previous release");
  }

  const commitMessage = formatCommitMessage(
    newVersion,
    previousVersion,
    userFacingCommits,
  );
  const releaseNotes = formatReleaseNotes(previousVersion, userFacingCommits);
  console.log(`Preparing dn ${newVersion}`);
  console.log(
    `Previous release: ${previousRelease.node} ${previousRelease.subject}`,
  );
  console.log(commitMessage.trimEnd());

  if (options.dryRun) {
    console.log("\nDry run complete. No files changed.");
    return;
  }

  const configText = await Deno.readTextFile("deno.json");
  await Deno.writeTextFile(
    "deno.json",
    configText.replace(
      `"version": "${previousVersion}"`,
      `"version": "${newVersion}"`,
    ),
  );
  await runInteractive(["make", "precommit"]);
  await assertOnlyVersionChanged();

  const updatedVersion = await readCurrentVersion();
  if (updatedVersion !== newVersion) {
    throw new Error(
      `Expected deno.json version ${newVersion}, found ${updatedVersion}`,
    );
  }

  const messagePath = await writeTempFile("dn-release-message-", commitMessage);
  const notesPath = await writeTempFile("dn-release-notes-", releaseNotes);
  try {
    await runInteractive(["sl", "commit", "-l", messagePath, "deno.json"]);
    await runInteractive(["make", "sync"]);
    await runInteractive([
      "dn",
      "release",
      "create",
      `v${newVersion}`,
      "--title",
      `v${newVersion}`,
      "--notes-file",
      notesPath,
      "--verify-tag",
    ]);
  } finally {
    await Deno.remove(messagePath).catch(() => {});
    await Deno.remove(notesPath).catch(() => {});
  }
}

if (import.meta.main) {
  try {
    await runRelease(parseArgs(Deno.args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
