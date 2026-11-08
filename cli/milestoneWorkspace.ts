// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { resolve } from "@std/path";
import { resolveGitHubToken } from "../sdk/github/token.ts";
import { resolveDnConfig } from "../sdk/config/mod.ts";
import {
  createDenoiseMilestone,
  getDenoiseMilestone,
  listDenoiseMilestones,
  updateDenoiseMilestone,
} from "../sdk/denoise/milestones.ts";
import {
  parseWorkspaceFlags,
  resolveWorkspaceBackend,
} from "../sdk/denoise/workspaceBackend.ts";
import { DEFAULT_DENOISE_API_URL } from "../sdk/runner/client.ts";

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

async function clientOptions(apiUrl: string | null) {
  const token = await resolveGitHubToken();
  const config = await resolveDnConfig({ repoRoot: Deno.cwd() });
  const origin = apiUrl?.trim() ||
    config.workspace?.api_url ||
    config.defaults?.workspace?.api_url ||
    DEFAULT_DENOISE_API_URL;
  return { githubToken: token, apiUrl: origin };
}

export async function handleMilestoneWithBackend(
  rawArgs: string[],
): Promise<boolean> {
  const subcommand = rawArgs[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return false;
  }
  const rest = rawArgs.slice(1);
  const { backend, args, apiUrl } = parseWorkspaceFlags(rest);
  const config = await resolveDnConfig({ repoRoot: Deno.cwd() });
  const resolved = resolveWorkspaceBackend({ explicit: backend, config });

  if (resolved === "github" || subcommand === "publish") {
    return false;
  }
  if (resolved !== "denoise") {
    if (backend === "denoise" || resolved === "todo") {
      throw new Error(
        "Denoise milestones require --denoise or workspace.default_backend: denoise",
      );
    }
    return false;
  }

  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
  }

  const opts = await clientOptions(apiUrl);

  switch (subcommand) {
    case "list":
    case "ls": {
      const milestones = await listDenoiseMilestones(opts);
      if (json) {
        console.log(JSON.stringify(milestones, null, 2));
        return true;
      }
      if (milestones.length === 0) {
        console.log("No milestones found.");
        return true;
      }
      for (const m of milestones) {
        console.log(`${m.id}  ${m.name}${m.archived ? " (archived)" : ""}`);
      }
      return true;
    }
    case "show":
    case "view": {
      const id = args.find((a) => !a.startsWith("--"));
      if (!id) {
        throw new Error("Usage: dn milestone show --denoise <milestone-id>");
      }
      const milestone = await getDenoiseMilestone(id, opts);
      if (json) {
        console.log(JSON.stringify(milestone, null, 2));
        return true;
      }
      console.log(milestone.name);
      console.log(`id: ${milestone.id}`);
      if (milestone.description) console.log(`\n${milestone.description}`);
      return true;
    }
    case "create": {
      let title: string | undefined;
      let descriptionFile: string | undefined;
      let dueOn: string | undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--title") title = optionValue(args, i++, "--title");
        else if (args[i] === "--description-file") {
          descriptionFile = optionValue(args, i++, "--description-file");
        } else if (args[i] === "--due-on") {
          dueOn = optionValue(args, i++, "--due-on");
        }
      }
      if (!title) throw new Error("--title is required");
      const description = descriptionFile
        ? await Deno.readTextFile(resolve(Deno.cwd(), descriptionFile))
        : undefined;
      const milestone = await createDenoiseMilestone(
        { name: title, description, dueDate: dueOn },
        opts,
      );
      if (json) {
        console.log(JSON.stringify(milestone, null, 2));
        return true;
      }
      console.log(`Created milestone ${milestone.id}: ${milestone.name}`);
      return true;
    }
    case "edit":
    case "update":
    case "archive": {
      const id = args.find((a) => !a.startsWith("--"));
      if (!id) {
        throw new Error("Usage: dn milestone edit --denoise <id> [options]");
      }
      let name: string | undefined;
      let descriptionFile: string | undefined;
      let archived: boolean | undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--title") name = optionValue(args, i++, "--title");
        else if (args[i] === "--description-file") {
          descriptionFile = optionValue(args, i++, "--description-file");
        } else if (args[i] === "--archive") archived = true;
        else if (args[i] === "--unarchive") archived = false;
      }
      if (subcommand === "archive") archived = true;
      const description = descriptionFile
        ? await Deno.readTextFile(resolve(Deno.cwd(), descriptionFile))
        : undefined;
      const milestone = await updateDenoiseMilestone(
        id,
        {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(archived !== undefined ? { archived } : {}),
        },
        opts,
      );
      if (json) {
        console.log(JSON.stringify(milestone, null, 2));
        return true;
      }
      console.log(`Updated milestone ${milestone.id}`);
      return true;
    }
    default:
      return false;
  }
}
