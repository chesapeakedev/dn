// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import {
  createMilestone,
  getCurrentRepoFromRemote,
  listOpenMilestones,
} from "../sdk/mod.ts";

interface RepoRef {
  owner: string;
  repo: string;
}

function parseRepo(value: string): RepoRef | null {
  const parts = value.split("/");
  return parts.length === 2 && parts[0] && parts[1]
    ? { owner: parts[0], repo: parts[1] }
    : null;
}

async function resolveRepo(repoArg: string | undefined): Promise<RepoRef> {
  if (repoArg) {
    const repo = parseRepo(repoArg);
    if (!repo) {
      throw new Error(`Invalid repository: ${repoArg}. Use owner/repo`);
    }
    return repo;
  }
  return await getCurrentRepoFromRemote();
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

async function handleCreate(args: string[]): Promise<void> {
  let title: string | undefined;
  let descriptionFile: string | undefined;
  let dueOn: string | undefined;
  let repoArg: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--title":
        title = optionValue(args, i++, "--title");
        break;
      case "--description-file":
        descriptionFile = optionValue(args, i++, "--description-file");
        break;
      case "--due-on":
        dueOn = optionValue(args, i++, "--due-on");
        break;
      case "--repo":
        repoArg = optionValue(args, i++, "--repo");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        showCreateHelp();
        return;
      default:
        throw new Error(`Unknown option: ${args[i]}`);
    }
  }

  if (!title) throw new Error("--title is required");
  const description = descriptionFile
    ? await Deno.readTextFile(descriptionFile)
    : undefined;
  const { owner, repo } = await resolveRepo(repoArg);
  const milestone = await createMilestone(owner, repo, {
    title,
    ...(description !== undefined && { description }),
    ...(dueOn !== undefined && { dueOn }),
  });

  if (json) {
    console.log(JSON.stringify(milestone, null, 2));
  } else {
    console.log(`Created milestone #${milestone.number}: ${milestone.title}`);
  }
}

function showCreateHelp(): void {
  console.log("dn milestone create - Create a GitHub milestone\n");
  console.log("Usage:");
  console.log("  dn milestone create --title <title> [options]\n");
  console.log("Options:");
  console.log("  --title <title>             Milestone title (required)");
  console.log("  --description-file <path>   Read description from a file");
  console.log("  --due-on <date>             Due date (ISO 8601)");
  console.log("  --repo <owner/repo>         Repository to modify");
  console.log("  --json                      Output as JSON");
}

async function handleList(args: string[]): Promise<void> {
  let repoArg: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo") repoArg = optionValue(args, i++, "--repo");
    else if (args[i] === "--json") json = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: dn milestone list [--repo owner/repo] [--json]");
      return;
    } else throw new Error(`Unknown option: ${args[i]}`);
  }

  const { owner, repo } = await resolveRepo(repoArg);
  const milestones = await listOpenMilestones(owner, repo);
  if (json) {
    console.log(JSON.stringify(milestones, null, 2));
    return;
  }
  if (milestones.length === 0) {
    console.log("No open milestones found.");
    return;
  }
  for (const milestone of milestones) {
    console.log(`#${milestone.number} ${milestone.title}`);
  }
}

/** Handle the `dn milestone` command. */
export async function handleMilestone(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log("dn milestone - Manage GitHub milestones\n");
    console.log("  create    Create a milestone");
    console.log("  list      List open milestones");
    return;
  }
  if (subcommand === "create") await handleCreate(args.slice(1));
  else if (subcommand === "list" || subcommand === "ls") {
    await handleList(args.slice(1));
  } else throw new Error(`Unknown milestone subcommand: ${subcommand}`);
}
