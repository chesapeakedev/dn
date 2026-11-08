// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * `dn research` — read-only codebase investigation for outer IDE harnesses.
 */

import { resolve } from "@std/path";
import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import { fetchDenoiseTaskRefFromParsed } from "../sdk/denoise/fetchTaskRef.ts";
import {
  isDenoiseTaskUrl,
  parseDenoiseTaskUrl,
} from "../sdk/denoise/taskUrl.ts";
import type { AgentSelection } from "../sdk/github/agentHarness.ts";
import {
  extractAgentSelectionFromArgs,
  mergeAgentSelections,
} from "../sdk/github/agentHarness.ts";
import { rejectBareGitHubNumber } from "../sdk/github/githubReferencePolicy.ts";
import { resolveGitHubToken } from "../sdk/github/token.ts";
import { isGitHubIssueUrl } from "../sdk/meld/mod.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import {
  extractSandboxFlag,
  resolveSandboxFlagValue,
} from "../sdk/sandbox/cli.ts";
import { resolveSandboxConfig } from "../sdk/sandbox/resolve.ts";
import { runWithSandboxLifecycle } from "../sdk/sandbox/lifecycle.ts";
import {
  denoiseTaskToMarkdown,
  validateDenoiseTaskDocument,
} from "../sdk/runner/types.ts";
import {
  type ResearchRunConfig,
  runResearchPhase,
} from "../kickstart/research.ts";
import { sanitizePlanName } from "../kickstart/planName.ts";
import { resolveContextFileArgs } from "./contextFiles.ts";
import { formatInfo } from "../kickstart/output.ts";

const PUBLISH_AND_WORKFLOW_FLAGS = new Set([
  "--publish",
  "--awp",
  "--skip-plan",
  "--plan-only",
  "--skip-review",
  "--cursor-cloud",
  "--milestone",
  "--complete",
  "--once",
  "--land",
]);

function parseVerbosity(value: string | undefined): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(
    `--verbosity requires low, medium, or high (received ${value ?? "none"}).`,
  );
}

function classifyResearchInput(input: string): {
  issueUrl: string | null;
  contextMarkdownPath?: string;
  denoiseTaskUrl?: string;
} {
  const trimmed = input.trim();
  if (isDenoiseTaskUrl(trimmed)) {
    return { issueUrl: null, denoiseTaskUrl: trimmed };
  }
  if (isGitHubIssueUrl(trimmed)) {
    rejectBareGitHubNumber(trimmed);
    return { issueUrl: trimmed, contextMarkdownPath: undefined };
  }
  rejectBareGitHubNumber(trimmed);
  return { issueUrl: null, contextMarkdownPath: trimmed };
}

async function resolveDenoiseTaskUrl(
  denoiseTaskUrl: string,
): Promise<{
  issueUrl: string | null;
  contextMarkdownPath?: string;
}> {
  const parsed = parseDenoiseTaskUrl(denoiseTaskUrl);
  if (!parsed) {
    throw new Error(`Invalid Denoise task URL: ${denoiseTaskUrl}`);
  }
  const token = await resolveGitHubToken();
  const ref = await fetchDenoiseTaskRefFromParsed(parsed, {
    githubToken: token,
  });
  if (ref.github_issue) {
    return { issueUrl: ref.github_issue.url };
  }
  const tmpFile = Deno.makeTempFileSync({
    prefix: "dn-denoise-task-",
    suffix: ".md",
  });
  Deno.writeTextFileSync(
    tmpFile,
    denoiseTaskToMarkdown(validateDenoiseTaskDocument(ref.task_document)),
  );
  return { issueUrl: null, contextMarkdownPath: tmpFile };
}

function showHelp(): void {
  console.log(`dn research - codebase research for outer IDE harnesses

Usage:
  dn research [options] <target>

Targets (full URLs for remote work; not bare issue numbers):
  https://github.com/owner/repo/issues/N
  https://denoise.cloud/task/<uuid>
  path/to/spec.md

Options:
  --steer <text>            Supplemental guidance for the research agent
  --context-file <path>     Include files in prompt (repeatable; global flag too)
  --allow-cross-repo, -A    Fetch issues from other repositories
  --verbosity <level>       low | medium | high (default: medium)
  --output, -o <path>       Also write report to a repo-relative path
  --plan-name <name>        Default -o plans/<name>.research.md when -o omitted
  --workspace-root <path>   Workspace root
  --agent <harness>         Nested agent (see dn --help)
  --sandbox <mode>          Sandbox provider
  --json                    Print JSON on stdout { markdown, bytes, output_path? }
  --help, -h                Show help

Default: validated markdown on stdout; progress and paths on stderr.
Does not implement, commit, or publish.`);
}

/** @internal Exported for tests. */
export async function parseResearchArgs(
  args: string[],
  globalAgent: AgentSelection | null = null,
  globalSandbox: SandboxFlagValue | null = null,
  globalContextFiles: readonly string[] = [],
): Promise<{
  help: boolean;
  json: boolean;
  config: ResearchRunConfig;
}> {
  let input: string | null = null;
  let allowCrossRepo = false;
  let workspaceRoot: string | undefined;
  let steeringPrompt: string | undefined;
  let verbosity: "low" | "medium" | "high" = "medium";
  let outputPath: string | null = null;
  let planName: string | null = null;
  let denoiseTaskPath: string | undefined;
  let json = false;
  let help = false;

  const { contextFiles, rest: argsAfterContext } = resolveContextFileArgs(
    args,
    globalContextFiles,
  );
  const { sandbox: localSandbox, rest: argsAfterSandbox } = extractSandboxFlag(
    argsAfterContext,
  );
  const { selection: localAgent, rest: flagArgs } =
    extractAgentSelectionFromArgs(argsAfterSandbox);
  const sandboxFlag = resolveSandboxFlagValue(globalSandbox, localSandbox);

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--allow-cross-repo" || arg === "-A") {
      allowCrossRepo = true;
    } else if (arg === "--steer") {
      steeringPrompt = flagArgs[++i];
      if (steeringPrompt === undefined) {
        throw new Error("--steer requires a value.");
      }
    } else if (arg === "--verbosity") {
      verbosity = parseVerbosity(flagArgs[++i]);
    } else if (arg === "--workspace-root") {
      workspaceRoot = flagArgs[++i];
    } else if (arg === "--output" || arg === "-o") {
      outputPath = flagArgs[++i];
      if (!outputPath) throw new Error(`${arg} requires a path.`);
    } else if (arg === "--plan-name" || arg === "--saved-plan") {
      planName = flagArgs[++i];
      if (!planName) throw new Error(`${arg} requires a name.`);
    } else if (arg === "--denoise-task") {
      denoiseTaskPath = flagArgs[++i];
    } else if (PUBLISH_AND_WORKFLOW_FLAGS.has(arg)) {
      throw new Error(`dn research does not accept ${arg}.`);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!input) {
      input = arg;
    } else {
      throw new Error("Provide exactly one target.");
    }
  }

  if (!input) {
    const fromEnv = Deno.env.get("ISSUE")?.trim();
    if (fromEnv) {
      rejectBareGitHubNumber(fromEnv);
      if (isGitHubIssueUrl(fromEnv) || isDenoiseTaskUrl(fromEnv)) {
        input = fromEnv;
      } else {
        throw new Error(
          "ISSUE must be a full GitHub issue URL or Denoise task URL.",
        );
      }
    }
  }

  if (denoiseTaskPath && !input) {
    const jsonText = await Deno.readTextFile(denoiseTaskPath);
    const task = validateDenoiseTaskDocument(JSON.parse(jsonText));
    const tmp = Deno.makeTempFileSync({
      prefix: "dn-denoise-task-",
      suffix: ".md",
    });
    Deno.writeTextFileSync(tmp, denoiseTaskToMarkdown(task));
    input = tmp;
  }

  if (!input && !help) {
    throw new Error(
      "Provide a GitHub issue URL, Denoise task URL, local .md path, or --denoise-task.",
    );
  }

  let issueUrl: string | null = null;
  let contextMarkdownPath: string | undefined;
  if (input) {
    const classified = classifyResearchInput(input);
    if (classified.denoiseTaskUrl) {
      const resolved = await resolveDenoiseTaskUrl(classified.denoiseTaskUrl);
      issueUrl = resolved.issueUrl;
      contextMarkdownPath = resolved.contextMarkdownPath;
    } else {
      issueUrl = classified.issueUrl;
      contextMarkdownPath = classified.contextMarkdownPath;
    }
  }

  if (planName && !outputPath) {
    outputPath = `plans/${sanitizePlanName(planName)}.research.md`;
  }

  const agentSelection = await resolveLocalAgentHarness({
    repoRoot: workspaceRoot ?? Deno.cwd(),
    agent: mergeAgentSelections(globalAgent, localAgent),
  });

  const config: ResearchRunConfig = {
    agentHarness: agentSelection.harness,
    ...(agentSelection.model ? { agentModel: agentSelection.model } : {}),
    ...(agentSelection.thinking
      ? { agentThinking: agentSelection.thinking }
      : {}),
    allowCrossRepo,
    issueUrl,
    ...(contextMarkdownPath ? { contextMarkdownPath } : {}),
    workspaceRoot,
    verbosity,
    ...(steeringPrompt ? { steeringPrompt } : {}),
    ...(contextFiles.length > 0 ? { contextFiles } : {}),
    ...(outputPath ? { outputPath } : {}),
    sandboxFlag,
  };

  return { help, json, config };
}

/** Handles the research subcommand. */
export async function handleResearch(
  args: string[],
  globalAgent: AgentSelection | null = null,
  globalSandbox: SandboxFlagValue | null = null,
  globalContextFiles: readonly string[] = [],
): Promise<void> {
  const parsed = await parseResearchArgs(
    args,
    globalAgent,
    globalSandbox,
    globalContextFiles,
  );
  if (parsed.help || args.length === 0) {
    showHelp();
    return;
  }

  const repoRoot = parsed.config.workspaceRoot ?? Deno.cwd();
  const { provider, config: sandboxConfig } = await resolveSandboxConfig(
    repoRoot,
    parsed.config.sandboxFlag ?? null,
  );

  await runWithSandboxLifecycle(
    { repoRoot, config: sandboxConfig, provider },
    async () => {
      const result = await runResearchPhase(parsed.config);
      const { markdown, outputPath } = result;
      const bytes = new TextEncoder().encode(markdown).byteLength;

      try {
        await Deno.remove(result.tmpDir, { recursive: true });
      } catch {
        // best-effort
      }

      if (parsed.json) {
        console.log(
          JSON.stringify({
            markdown,
            bytes,
            ...(outputPath ? { output_path: outputPath } : {}),
          }),
        );
        return;
      }

      console.log(markdown);
      if (outputPath) {
        console.error(
          formatInfo(`Also wrote ${resolve(repoRoot, outputPath)}`),
        );
      }
    },
  );
}
