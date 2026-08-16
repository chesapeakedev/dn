// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn meld subcommand handler
 *
 * Runs the canonical planning workflow from one or more sources.
 */

import type { KickstartConfig } from "../kickstart/lib.ts";
import {
  fillEmptyIssueSections,
  generateMilestoneDescription,
  runMeldPhase,
} from "../kickstart/lib.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { parseAgentHarnessFlagsFromArgs } from "../sdk/github/agentHarness.ts";
import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import { enforceStrictRfcCorpus } from "../sdk/config/strict.ts";
import { getCurrentRepoFromRemote } from "../sdk/github/github-gql.ts";
import { resolveIssueUrlInput } from "../sdk/github/issue.ts";
import {
  deduplicateBlocks,
  ensureAcceptanceCriteriaSection,
  isGitHubIssueUrl,
  type MeldMode,
  mergeMarkdown,
  normalizeMarkdown,
  resolveSource,
} from "../sdk/mod.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import {
  extractSandboxFlag,
  resolveSandboxFlagValue,
} from "../sdk/sandbox/cli.ts";
import { resolveSandboxConfig } from "../sdk/sandbox/resolve.ts";
import { runWithSandboxLifecycle } from "../sdk/sandbox/lifecycle.ts";
import { promptAndAddToTodoList } from "../sdk/todo/todo.ts";

const ISSUE_NUMBER_PATTERN = /^#?\d+$/;

function isIssueReference(source: string): boolean {
  const trimmed = source.trim();
  return isGitHubIssueUrl(trimmed) || ISSUE_NUMBER_PATTERN.test(trimmed);
}

function agentHarnessToMeldMode(harness: AgentHarness): MeldMode {
  if (harness === "cursor") {
    return "cursor";
  }
  if (harness === "claude") {
    return "claude";
  }
  return "opencode";
}

interface MeldArgs {
  sources: string[];
  outputPath: string | null;
  mode: MeldMode;
  agentHarness: AgentHarness;
  planName: string | null;
  workspaceRoot: string | undefined;
  target: string | null;
  overwrite: boolean;
  dryRun: boolean;
  autoYes: boolean;
  allowCrossRepo: boolean;
  updateIssue: boolean;
  milestone: string | null;
}

async function parseArgs(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): Promise<MeldArgs & { sandboxFlag: SandboxFlagValue | null }> {
  let listPath: string | null = null;
  let outputPath: string | null = null;
  let planName: string | null = null;
  let workspaceRoot: string | undefined = undefined;
  let target: string | null = null;
  let overwrite = false;
  let dryRun = false;
  let autoYes = false;
  let allowCrossRepo = false;
  let updateIssue = false;
  let milestone: string | null = null;
  let issueUrl: string | null = null;
  const positionals: string[] = [];

  const { sandbox: localSandbox, rest: flagArgs } = extractSandboxFlag(args);
  const sandboxFlag = resolveSandboxFlagValue(globalSandbox, localSandbox);

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--list" || arg === "-l") {
      if (i + 1 < flagArgs.length) {
        listPath = flagArgs[++i];
      }
    } else if (arg === "--output" || arg === "-o") {
      if (i + 1 < flagArgs.length) {
        outputPath = flagArgs[++i];
      }
    } else if (arg === "--plan-name") {
      if (i + 1 < flagArgs.length) {
        planName = flagArgs[++i];
      }
    } else if (arg === "--workspace-root" && i + 1 < flagArgs.length) {
      workspaceRoot = flagArgs[++i];
    } else if (arg === "--target" && i + 1 < flagArgs.length) {
      target = flagArgs[++i];
    } else if (arg === "--issue-url" && i + 1 < flagArgs.length) {
      issueUrl = flagArgs[++i];
    } else if (arg === "--update-issue" || arg === "--fill-template") {
      updateIssue = true;
    } else if (arg === "--milestone" || arg === "-m") {
      if (i + 1 >= flagArgs.length) {
        throw new Error(
          "--milestone requires a milestone number, title, or URL.",
        );
      }
      milestone = flagArgs[++i];
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      autoYes = true;
    } else if (arg === "--allow-cross-repo" || arg === "-A") {
      allowCrossRepo = true;
    } else if (
      arg === "--cursor" || arg === "-c" || arg === "--claude" ||
      arg === "--opencode" || arg === "--codex" || arg === "--copilot"
    ) {
      // Agent flags are resolved after the loop via parseAgentHarnessFlagsFromArgs.
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }

  let sources = issueUrl === null ? positionals : [...positionals, issueUrl];
  if (listPath !== null) {
    try {
      const listContent = await Deno.readTextFile(listPath);
      sources = listContent
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (e) {
      console.error(`Error reading list file ${listPath}:`, e);
      Deno.exit(1);
    }
  }
  if (sources.length === 0 && milestone === null) {
    const issueFromEnvironment = Deno.env.get("ISSUE");
    if (issueFromEnvironment) {
      sources = [issueFromEnvironment];
    }
  }

  const agentHarness = await resolveLocalAgentHarness({
    repoRoot: Deno.cwd(),
    agent: globalAgent,
    ...parseAgentHarnessFlagsFromArgs(args),
  });
  const mode = agentHarnessToMeldMode(agentHarness);

  return {
    sources,
    outputPath,
    mode,
    agentHarness,
    planName,
    workspaceRoot,
    target,
    overwrite,
    dryRun,
    autoYes,
    allowCrossRepo,
    updateIssue,
    milestone,
    sandboxFlag,
  };
}

function showHelp(): void {
  console.log("dn meld - Plan from one or more sources\n");
  console.log("Usage:");
  console.log("  dn meld [options] <source> [source ...]");
  console.log("  dn meld --list <file> [options]\n");
  console.log(
    "Sources: local .md paths, GitHub issue URLs, or issue numbers for the current repository.",
  );
  console.log(
    "Merged markdown feeds the planner; `--target` selects where agent output lands.",
  );
  console.log("Options:");
  console.log(
    "  --issue-url <ref>        Compatibility form for one issue source",
  );
  console.log(
    "  --milestone, -m <ref>    Generate a description from milestone issues",
  );
  console.log(
    "  --update-issue           Fill empty issue-template sections",
  );
  console.log(
    "  --fill-template          Alias for --update-issue",
  );
  console.log("  --target <path-or-github> Output file or GitHub specifier");
  console.log(
    "    Supports README.md, AGENTS.md, CONTRIBUTING.md, plans/*.plan.md, other *.md paths,",
  );
  console.log(
    "    plus `github:issue:<ref>` or `github:comment:<ref>` for the checked-out repo.",
  );
  console.log(
    "  --overwrite             Replace targets instead of merge-style edits",
  );
  console.log(
    "  --dry-run               Resolve prompts/paths without invoking agents or GitHub mutations",
  );
  console.log(
    "  --yes, -y               Auto-approve prompts in unattended merges",
  );
  console.log("  --allow-cross-repo, -A  Allow mismatched repositories");
  console.log(
    "  --list, -l <path>       Newline-separated sources (POSIX style)",
  );
  console.log(
    "  --output, -o <path>     Write merged *input* markdown before planner runs",
  );
  console.log(
    "  --plan-name <name>      When targeting default plans (`plans/*.plan.md`), skip naming prompt",
  );
  console.log(
    "  --workspace-root <path> Workspace root (default cwd / WORKSPACE_ROOT)",
  );
  console.log(
    "  --cursor, -c            Cursor planner harness",
  );
  console.log("  --claude                  Claude planner harness");
  console.log(
    "  --codex                   Codex planner harness",
  );
  console.log(
    "  --copilot                 GitHub Copilot CLI (`copilot -p`)",
  );
  console.log(
    "  --opencode                Opencode planner harness (default)",
  );
  console.log("  --help, -h                Print help\n");
  console.log(
    "Merged context (`--output`/temp) is pre-agent markdown; `--target` is planner output.",
  );
  console.log("Examples:");
  console.log("  dn meld 123");
  console.log("  dn meld docs/spec.md");
  console.log(
    "  dn meld findings.md ticket.md --target README.md --workspace-root .",
  );
  console.log(
    "  dn meld research.md --target github:comment:120 --overwrite --dry-run",
  );
  console.log("  dn meld --milestone 42");
  console.log("  dn meld --update-issue --dry-run 123");
  console.log("  dn meld -l sources.txt -o plans/merged.md --plan-name merged");
}

export async function handleMeld(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): Promise<void> {
  const {
    sources,
    outputPath,
    mode,
    agentHarness,
    planName,
    workspaceRoot,
    target,
    overwrite,
    dryRun,
    autoYes,
    allowCrossRepo,
    updateIssue,
    milestone,
    sandboxFlag,
  } = await parseArgs(args, globalAgent, globalSandbox);

  if (milestone !== null && updateIssue) {
    console.error("Error: --milestone cannot be used with --update-issue.");
    console.error("\nUse 'dn meld --help' for usage information.");
    Deno.exit(1);
  }
  if (milestone !== null && sources.length > 0) {
    console.error(
      "Error: --milestone cannot be used with issue or markdown sources.",
    );
    console.error("\nUse 'dn meld --help' for usage information.");
    Deno.exit(1);
  }
  if (updateIssue && (sources.length !== 1 || !isIssueReference(sources[0]))) {
    console.error(
      "Error: --update-issue requires exactly one issue URL or issue number.",
    );
    console.error("\nUse 'dn meld --help' for usage information.");
    Deno.exit(1);
  }
  if (milestone === null && sources.length === 0) {
    console.error(
      "Error: No sources provided. Use positionals or --list <file>.",
    );
    console.error("\nUse 'dn meld --help' for usage information.");
    Deno.exit(1);
  }

  try {
    const resolvedWorkspaceRoot = workspaceRoot ||
      Deno.env.get("WORKSPACE_ROOT") || Deno.cwd();

    await enforceStrictRfcCorpus(resolvedWorkspaceRoot);

    if (milestone !== null) {
      const result = await generateMilestoneDescription(
        milestone,
        resolvedWorkspaceRoot,
        agentHarness,
      );
      if (result.error || !result.success) {
        throw new Error(result.error ?? "Milestone planning failed");
      }

      console.log(`\n${result.descriptionFilePath}`);
      const repo = await getCurrentRepoFromRemote().then(
        (current) => `${current.owner}/${current.repo}`,
      ).catch(() => undefined);
      await promptAndAddToTodoList(
        [{
          ref: result.descriptionFilePath,
          title: result.milestone?.title ?? "Milestone description",
        }],
        {
          repo,
          updated: new Date().toISOString().slice(0, 10),
        },
      );
      Deno.exit(0);
    }

    if (updateIssue) {
      const result = await fillEmptyIssueSections(
        sources[0],
        resolvedWorkspaceRoot,
        dryRun,
        agentHarness,
      );
      if (result.error) {
        throw new Error(result.error);
      }
      if (result.updated) {
        console.log(
          `\nFilled sections: ${result.filledSections.join(", ") || "none"}`,
        );
        console.log(
          `Preserved sections: ${result.skippedSections.join(", ") || "none"}`,
        );
      } else if (result.filledSections.length > 0) {
        console.log(
          `\nWould fill sections: ${
            result.filledSections.join(", ") || "none"
          }`,
        );
        console.log(
          `Would preserve sections: ${
            result.skippedSections.join(", ") || "none"
          }`,
        );
      }
      Deno.exit(0);
    }

    const directIssueSource = sources.length === 1 &&
        outputPath === null &&
        isIssueReference(sources[0])
      ? sources[0]
      : null;
    const resolved: string[] = [];
    let contextPath: string | undefined;
    if (directIssueSource === null) {
      for (const src of sources) {
        try {
          const resolvedSource = ISSUE_NUMBER_PATTERN.test(src.trim())
            ? await resolveIssueUrlInput(src)
            : src;
          const content = await resolveSource(resolvedSource);
          resolved.push(content);
        } catch (e) {
          if (src.trim() === "") continue;
          console.error(`Error resolving ${src}:`, e);
          Deno.exit(1);
        }
      }

      const normalized = resolved.map((c) => normalizeMarkdown(c)).filter(
        Boolean,
      );
      if (normalized.length === 0) {
        console.error("Error: No content after resolving sources.");
        Deno.exit(1);
      }

      let merged = mergeMarkdown(normalized);
      merged = ensureAcceptanceCriteriaSection(merged, mode);
      merged = deduplicateBlocks(merged);

      const out = merged + "\n";
      contextPath = outputPath !== null ? outputPath : await Deno.makeTempFile({
        prefix: "dn-meld-",
        suffix: ".md",
      });

      await Deno.writeTextFile(contextPath, out);
    }

    const ks: KickstartConfig = {
      publish: "none" as const,
      agentHarness,
      allowCrossRepo,
      issueUrl: directIssueSource,
      contextMarkdownPath: contextPath,
      saveCtx: false,
      savedPlanName: planName,
      workspaceRoot,
      verbosity: "medium",
      skipPlan: false,
      meldPhase: {
        targetRaw: target,
        overwrite,
        dryRun,
        autoYes,
      },
    };

    const repoRoot = workspaceRoot ?? Deno.cwd();
    const { provider, config: sandboxConfig } = await resolveSandboxConfig(
      repoRoot,
      sandboxFlag,
    );
    await runWithSandboxLifecycle(
      { repoRoot, config: sandboxConfig, provider },
      async () => {
        const result = await runMeldPhase(ks);

        if (result.publishedUrl) {
          console.log(`\n${result.publishedUrl}`);
        } else {
          console.log(`\n${result.planFilePath}`);
        }
        return;
      },
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
