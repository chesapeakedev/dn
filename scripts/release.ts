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

interface ReleaseOptions {
  dryRun: boolean;
}

function parseArgs(args: string[]): ReleaseOptions {
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun };
}

function showHelp(): void {
  console.log("release.ts - Run the dn patch release workflow\n");
  console.log("Usage:");
  console.log(
    "  deno run --allow-read --allow-write --allow-run scripts/release.ts",
  );
  console.log(
    "  deno run --allow-read --allow-write --allow-run scripts/release.ts --dry-run",
  );
}

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

async function writeTempFile(prefix: string, content: string): Promise<string> {
  const path = await Deno.makeTempFile({ prefix, suffix: ".md" });
  await Deno.writeTextFile(path, content);
  return path;
}

async function runRelease(options: ReleaseOptions): Promise<void> {
  await assertCleanWorkingCopy();

  const previousVersion = await readCurrentVersion();
  const newVersion = bumpPatchVersion(previousVersion);
  const previousRelease = findPreviousReleaseCommit(
    await listAncestorCommits(),
    previousVersion,
  );

  if (!previousRelease) {
    throw new Error(
      `Could not find an ancestor commit whose subject starts with ${previousVersion}`,
    );
  }

  const commits = await listCommitsSince(previousRelease.node);
  if (commits.length === 0) {
    throw new Error(
      `No commits found since ${previousRelease.node} (${previousRelease.subject})`,
    );
  }

  const commitMessage = formatCommitMessage(
    newVersion,
    previousVersion,
    commits,
  );
  const releaseNotes = formatReleaseNotes(previousVersion, commits);

  console.log(`Preparing dn ${newVersion}`);
  console.log(
    `Previous release: ${previousRelease.node} ${previousRelease.subject}`,
  );
  console.log(commitMessage.trimEnd());

  if (options.dryRun) {
    console.log("\nDry run complete. No files changed.");
    return;
  }

  await runInteractive(["make", "bump_patch"]);
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
