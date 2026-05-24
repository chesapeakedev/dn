// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * `dn workflow run` — trigger a workflow_dispatch event.
 */

import {
  getCurrentRepoFromRemote,
  getDefaultBranch,
} from "../../sdk/github/github-gql.ts";
import {
  dispatchWorkflow,
  parseWorkflowFields,
  resolveWorkflow,
  workflowBase,
  type WorkflowDispatchInputs,
} from "../../sdk/github/workflow.ts";
import { isTty } from "../output.ts";
import { parseRepoRef, type RepoRef } from "../issue.ts";

interface RunOptions {
  selector: string;
  ref?: string;
  repo?: RepoRef;
  rawFields: string[];
  magicFields: string[];
  jsonInput?: string;
}

function showHelp(): void {
  console.log("dn workflow run - Trigger a workflow_dispatch event\n");
  console.log("Usage:");
  console.log(
    "  dn workflow run [<workflow-id> | <workflow-name>] [options]\n",
  );
  console.log("Options:");
  console.log(
    "  --repo, -R <owner/repo>   Target repository (default: current remote)",
  );
  console.log(
    "  --ref, -r <ref>           Branch or tag containing the workflow file",
  );
  console.log("  -f, --raw-field <k=v>     String workflow input");
  console.log(
    "  -F, --field <k=v>           String input; @path reads file contents",
  );
  console.log(
    "  --json                    Read workflow inputs as JSON from stdin\n",
  );
  console.log("Examples:");
  console.log("  dn workflow run release.yml");
  console.log("  dn workflow run triage.yml --ref my-branch");
  console.log("  dn workflow run triage.yml -f name=scully -f greeting=hello");
  console.log(
    '  echo \'{"name":"scully"}\' | dn workflow run triage.yml --json\n',
  );
  console.log("Not yet implemented:");
  console.log(
    "  Interactive workflow and input prompts when selector is omitted",
  );
}

/**
 * Parse flags and positional args for `dn workflow run`.
 * Exported for unit tests.
 */
export async function parseWorkflowRunArgs(
  args: string[],
): Promise<RunOptions> {
  const rawFields: string[] = [];
  const magicFields: string[] = [];
  let repo: RepoRef | undefined;
  let ref: string | undefined;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    }
    if (arg === "--repo" || arg === "-R") {
      if (i + 1 >= args.length) {
        throw new Error("--repo requires owner/repo");
      }
      const parsed = parseRepoRef(args[++i]);
      if (!parsed) {
        throw new Error(`Invalid repository: ${args[i]}. Use owner/repo`);
      }
      repo = parsed;
      continue;
    }
    if (arg === "--ref" || arg === "-r") {
      if (i + 1 >= args.length) {
        throw new Error("--ref requires a branch or tag name");
      }
      ref = args[++i];
      continue;
    }
    if (arg === "--raw-field" || arg === "-f") {
      if (i + 1 >= args.length) {
        throw new Error(`${arg} requires key=value`);
      }
      rawFields.push(args[++i]);
      continue;
    }
    if (arg === "--field" || arg === "-F") {
      if (i + 1 >= args.length) {
        throw new Error(`${arg} requires key=value`);
      }
      magicFields.push(args[++i]);
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  const selector = positional[0] ?? "";
  const inputFieldsPassed = rawFields.length + magicFields.length > 0;

  if (inputFieldsPassed && !selector) {
    throw new Error("workflow argument required when passing -f or -F");
  }

  if (!selector) {
    throw new Error(
      "workflow ID, name, or filename required when not running interactively",
    );
  }

  let jsonInput: string | undefined;
  if (json) {
    if (Deno.stdin.isTerminal()) {
      throw new Error("--json specified but nothing on STDIN");
    }
    const chunks: Uint8Array[] = [];
    const reader = Deno.stdin.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    if (total === 0) {
      throw new Error("--json specified but nothing on STDIN");
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    jsonInput = new TextDecoder().decode(merged).trim();
    if (inputFieldsPassed) {
      throw new Error("only one of STDIN or -f/-F can be passed");
    }
    if (!selector) {
      throw new Error("workflow argument required when passing JSON");
    }
  }

  return {
    selector,
    ref,
    repo,
    rawFields,
    magicFields,
    jsonInput,
  };
}

async function resolveRepo(repoOverride?: RepoRef): Promise<RepoRef> {
  if (repoOverride) {
    return repoOverride;
  }
  return await getCurrentRepoFromRemote();
}

async function readInputs(
  options: RunOptions,
): Promise<WorkflowDispatchInputs> {
  if (options.jsonInput !== undefined) {
    const parsed = JSON.parse(options.jsonInput) as unknown;
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    ) {
      throw new Error("could not parse provided JSON: expected an object");
    }
    const inputs: WorkflowDispatchInputs = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        throw new Error(
          `could not parse provided JSON: input ${
            JSON.stringify(key)
          } must be a string`,
        );
      }
      inputs[key] = value;
    }
    return inputs;
  }

  return await parseWorkflowFields(
    options.rawFields,
    options.magicFields,
    async (path) => await Deno.readTextFile(path),
  );
}

/**
 * Handle `dn workflow run`.
 */
export async function handleWorkflowRun(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  let options: RunOptions;
  try {
    options = await parseWorkflowRunArgs(args);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }

  const { owner, repo } = await resolveRepo(options.repo);

  const ref = options.ref ?? await getDefaultBranch(owner, repo);

  const workflow = await resolveWorkflow(owner, repo, options.selector);
  const inputs = await readInputs(options);

  const result = await dispatchWorkflow(owner, repo, workflow.id, {
    ref,
    inputs,
  });

  const tty = isTty();
  if (tty) {
    console.log(
      `Created workflow_dispatch event for ${
        workflowBase(workflow.path)
      } at ${ref}`,
    );
    if (result.htmlUrl) {
      console.log(result.htmlUrl);
    }
    console.log();
  } else if (result.htmlUrl) {
    console.log(result.htmlUrl);
  }
}
