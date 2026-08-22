// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { resolveGitHubToken } from "../sdk/github/token.ts";
import {
  getMilestoneFromInput,
  listOpenMilestones,
  type Milestone,
} from "../sdk/github/milestone.ts";
import { runScoring } from "../kickstart/score.ts";
import type { AgentSelection } from "../sdk/github/agentHarness.ts";
import {
  extractAgentSelectionFromArgs,
  mergeAgentSelections,
} from "../sdk/github/agentHarness.ts";
import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import { stringifyFrontmatter } from "../sdk/todo/frontmatter.ts";
import {
  getStackArtifactPaths,
  mergeStackCheckmarks,
} from "../sdk/github/stack.ts";
import type { PublishMode, StackMode } from "../sdk/github/publish.ts";
import {
  parsePublishMode,
  resolveInitStackPublishMode,
  writeGithubActionVcsOutputs,
} from "../sdk/github/publish.ts";
import { isCI, isUnattended } from "../sdk/github/output.ts";
import { confirmDestructiveOverwrite } from "../sdk/github/filePrompt.ts";
import {
  commitStackArtifacts,
  publishStackArtifactsPullRequest,
} from "../sdk/github/vcs.ts";

/**
 * Parsed CLI flags for `dn init stack`.
 *
 * The command accepts one milestone reference plus a small set of behavior
 * flags. The parsed shape is kept explicit so the main handler can stay mostly
 * linear and easy to read.
 */
interface InitStackConfig {
  milestone: string | null;
  stackMode: StackMode | null;
  refresh: boolean;
  overwrite: boolean;
  publish: PublishMode | null;
  autoYes: boolean;
  help: boolean;
}

/**
 * Prints subcommand usage, examples, and the high-level workflow the command
 * performs when it succeeds.
 */
function showHelp(): void {
  console.log(
    "dn init stack - Initialize stack context from GitHub milestone\n",
  );
  console.log("Usage:");
  console.log("  dn init stack <milestone-id-or-url> [options]\n");
  console.log("Arguments:");
  console.log(
    "  <milestone-id-or-url>  GitHub milestone number or URL (required)",
  );
  console.log("Options:");
  console.log(
    "  --refresh                     Regenerate stack, preserving completed checkmarks",
  );
  console.log(
    "  --overwrite                   Replace the entire stack file (destructive)",
  );
  console.log(
    "  --publish <none|pr|direct>    Publish stack files (default: none locally, pr in CI)",
  );
  console.log(
    "  --yes                         Approve destructive overwrite without prompting",
  );
  console.log(
    "  --agent <agent>              <harness>:<model> (harness-only or optional :<thinking>)",
  );
  console.log("  --help, -h                    Show this help message\n");
  console.log("Examples:");
  console.log("  dn init stack 42");
  console.log(
    "  dn init stack https://github.com/owner/repo/milestone/3\n",
  );
  console.log("This command:");
  console.log("  1. Fetches the GitHub milestone and its open issues");
  console.log("  2. Scores each issue for kickstart readiness");
  console.log(
    "  3. Creates plans/{owner}_{repo}_{milestone-number}.stack.md with prioritized tasks",
  );
  console.log("  4. Output instructions to commit the stack file to the repo");
}

/**
 * Converts raw CLI arguments into the configuration expected by
 * {@link handleInitStack}.
 *
 * Unknown flags are ignored here and will simply not affect behavior. The last
 * non-flag argument wins, which keeps parsing predictable without introducing a
 * heavier CLI framework.
 */
function parseArgs(args: string[]): InitStackConfig {
  const config: InitStackConfig = {
    milestone: null,
    stackMode: null,
    refresh: false,
    overwrite: false,
    publish: null,
    autoYes: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
    } else if (arg === "--refresh") {
      config.refresh = true;
    } else if (arg === "--overwrite") {
      config.overwrite = true;
    } else if (arg === "--yes" || arg === "-y") {
      config.autoYes = true;
    } else if (arg === "--publish" && i + 1 < args.length) {
      config.publish = parsePublishMode(args[++i]);
    } else if (!arg.startsWith("-")) {
      config.milestone = arg;
    }
  }

  return config;
}

/**
 * Returns whether stderr is attached to a terminal.
 *
 * Interactive milestone selection is only safe when a TTY is present. Any
 * runtime failure while probing terminal state is treated as non-interactive.
 */
function resolveInitStackMode(config: InitStackConfig): StackMode {
  if (config.stackMode) return config.stackMode;
  if (config.overwrite) return "overwrite";
  if (config.refresh) return "refresh";
  return "create";
}

function promptStackUpdateMode(): StackMode {
  console.log("\nA stack file already exists for this milestone.");
  console.log(
    "  1) Refresh — update scores/order and preserve completed tasks",
  );
  console.log("  2) Overwrite — regenerate from scratch (loses checkmarks)");
  console.log("  3) Cancel");
  const input = prompt("Choose an option [1/2/3]: ")?.trim();
  if (input === "2") return "overwrite";
  if (input === "3" || input?.toLowerCase() === "c") {
    throw new Error("Stack initialization cancelled.");
  }
  return "refresh";
}

/**
 * Finds the repository root for the current working directory.
 *
 * `dn init stack` writes generated artifacts into `plans/`, so it must confirm
 * it is running from a repository checkout first. Both Sapling and Git working
 * copies are accepted because GitHub metadata resolution depends on repo state,
 * not the VCS brand.
 */
async function detectRepoRoot(): Promise<string> {
  const cwd = Deno.cwd();

  try {
    await Deno.stat(`${cwd}/.sl`);
    return cwd;
  } catch {
    // Not sapling
  }

  try {
    await Deno.stat(`${cwd}/.git`);
    return cwd;
  } catch {
    // Not git either
  }

  throw new Error(
    "Not in a git or sapling repository. Please run from a repository with a GitHub remote.",
  );
}

/**
 * Renders the human-readable stack plan stored in
 * `plans/{owner}_{repo}_{milestone-number}.stack.md`.
 *
 * The markdown file is optimized for people and agents: frontmatter captures
 * stable metadata, the checklist is ordered by kickstart readiness, and
 * disqualified issues retain their rejection reason for follow-up.
 */
function formatPlanFile(
  milestone: Milestone,
  owner: string,
  repo: string,
  scored: Array<
    { ref: string; title: string; score: number | undefined; url: string }
  >,
  disqualified: Array<
    { ref: string; title: string; reason: string; url: string }
  >,
  useIssueUrls: boolean,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const generatedAt = new Date().toISOString();

  const frontmatter: Record<string, string> = {
    milestone: String(milestone.number),
    milestone_title: milestone.title,
    repo: `${owner}/${repo}`,
    updated: today,
    generated_at: generatedAt,
  };

  if (scored.length > 0) {
    frontmatter.issue_count = String(scored.length);
  }

  const lines: string[] = [];
  lines.push("<!--");
  lines.push(
    "  SYSTEM: This file is a milestone stack generated by `dn init stack`.",
  );
  lines.push("  Agents should process issues in order (easiest first).");
  lines.push(
    "  Each issue should be kicked off using: dn kickstart #<number> or a full issue URL.",
  );
  lines.push("-->");
  lines.push("");
  lines.push(`# Milestone: ${milestone.title}`);
  lines.push("");
  lines.push("## Prioritized Tasks (easiest first)");
  lines.push("");

  for (const item of scored) {
    const check = item.score != null ? ` ${item.score}` : "";
    const ref = useIssueUrls ? item.url : `#${item.ref}`;
    lines.push(`- [ ]${check} ${ref} ${item.title}`);
  }

  if (disqualified.length > 0) {
    lines.push("");
    lines.push("## Disqualified (not ready for kickstart)");
    lines.push("");
    for (const item of disqualified) {
      const ref = useIssueUrls ? item.url : `#${item.ref}`;
      lines.push(`- [ ] _${ref} ${item.title}_`);
      lines.push(`  - Reason: ${item.reason}`);
    }
  }

  if (milestone.description) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(milestone.description);
  }

  return stringifyFrontmatter(frontmatter, lines.join("\n"));
}

/**
 * Machine-readable representation of one milestone issue inside the generated
 * stack index.
 */
interface StackIssue {
  number: number;
  url: string;
  title: string;
  score: number | null;
  scoring_source: "agent";
  scoring_confidence: "unknown";
  recommended_order_rank: number | null;
  disqualified: boolean;
  reason?: string;
}

/**
 * JSON index written next to the markdown stack file for integrations that need
 * structured milestone state instead of parsing checklist text.
 */
interface StackIndex {
  version: string;
  milestone: {
    number: number;
    title: string;
  };
  repo: {
    owner: string;
    name: string;
    full_name: string;
  };
  generated_at: string;
  issues: StackIssue[];
  kickstart_order: number[];
}

/**
 * Persists the structured stack index at
 * `plans/{owner}_{repo}_{milestone-number}.stack.json`.
 *
 * The JSON artifact mirrors the markdown plan but preserves scores,
 * disqualification state, and explicit kickstart order for tooling.
 */
async function writeStackIndex(
  repoRoot: string,
  milestone: Milestone,
  owner: string,
  repo: string,
  scored: Array<
    { ref: string; title: string; score: number | undefined; url: string }
  >,
  disqualified: Array<
    { ref: string; title: string; reason: string; url: string }
  >,
): Promise<void> {
  const generatedAt = new Date().toISOString();
  const scoredItems = scored.map((s, index) => ({
    number: parseInt(s.ref, 10),
    url: s.url,
    title: s.title,
    score: s.score ?? null,
    scoring_source: "agent" as const,
    scoring_confidence: "unknown" as const,
    recommended_order_rank: index + 1,
    disqualified: false,
  }));
  const disqualifiedItems = disqualified.map((d) => ({
    number: parseInt(d.ref, 10),
    url: d.url,
    title: d.title,
    score: null,
    scoring_source: "agent" as const,
    scoring_confidence: "unknown" as const,
    recommended_order_rank: null,
    disqualified: true,
    reason: d.reason,
  }));

  const index: StackIndex = {
    version: "1.0",
    milestone: {
      number: milestone.number,
      title: milestone.title,
    },
    repo: {
      owner,
      name: repo,
      full_name: `${owner}/${repo}`,
    },
    generated_at: generatedAt,
    issues: [...scoredItems, ...disqualifiedItems],
    kickstart_order: scored.map((s) => parseInt(s.ref, 10)),
  };

  const { jsonPath } = getStackArtifactPaths(
    repoRoot,
    owner,
    repo,
    milestone.number,
  );
  const content = JSON.stringify(index, null, 2);
  await Deno.writeTextFile(jsonPath, content);
  console.log(`Created: ${jsonPath}`);
}

/**
 * Initializes milestone stack artifacts for the current repository.
 *
 * The command resolves a GitHub milestone, scores its open issues for
 * kickstart readiness, writes both markdown and JSON stack artifacts under
 * `plans/`, and prints the follow-up commands needed to commit and use them.
 */
export async function handleInitStack(
  args: string[],
  globalAgent: AgentSelection | null = null,
): Promise<void> {
  const { selection: localAgent, rest: restArgs } =
    extractAgentSelectionFromArgs(args);
  const config = parseArgs(restArgs);

  if (config.help) {
    showHelp();
    return;
  }

  console.log("Initializing stack context from GitHub milestone...\n");

  if (config.refresh) {
    console.log("Refreshing milestone plan...\n");
  }

  const repoRoot = await detectRepoRoot();
  console.log(`Repository root: ${repoRoot}`);

  try {
    await resolveGitHubToken();
  } catch {
    throw new Error(
      "GitHub authentication required. Run 'dn auth' first or ensure gh is logged in.",
    );
  }

  let milestoneInput = config.milestone;

  if (!milestoneInput) {
    const { owner, repo } = await import("../sdk/github/github-gql.ts").then(
      (m) => m.getCurrentRepoFromRemote(),
    );
    const milestones = await listOpenMilestones(owner, repo);

    if (milestones.length === 0) {
      throw new Error(
        `No open milestones found in ${owner}/${repo}. Create a milestone first on GitHub.`,
      );
    }

    console.log("Select a milestone:");
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      console.log(
        `  ${i + 1}) #${m.number} ${m.title}${
          m.dueOn ? ` (due: ${m.dueOn.slice(0, 10)})` : ""
        }`,
      );
    }
    console.log("");

    const tty = isUnattended() === false && Deno.stdin.isTerminal?.() === true;
    if (!tty) {
      throw new Error(
        "No milestone specified and not in interactive mode. Pass a milestone number or URL.",
      );
    }

    const input = prompt("Enter number (or milestone URL/number):")?.trim();
    if (!input) {
      throw new Error("No milestone selected.");
    }

    const numMatch = input.match(/^(\d+)$/);
    if (numMatch && parseInt(numMatch[1], 10) <= milestones.length) {
      const idx = parseInt(numMatch[1], 10) - 1;
      milestoneInput = String(milestones[idx].number);
    } else {
      milestoneInput = input;
    }
  }

  console.log(`Fetching milestone: ${milestoneInput}`);
  const useIssueUrls = milestoneInput.startsWith("http://") ||
    milestoneInput.startsWith("https://");
  const { milestone, owner, repo } = await getMilestoneFromInput(
    milestoneInput,
  );

  if (milestone.issues.length === 0) {
    console.log("No open issues found in this milestone.");
    console.log("Add issues to the milestone on GitHub, then run this again.");
    return;
  }

  console.log(
    `Found ${milestone.issues.length} open issues in milestone #${milestone.number}`,
  );

  const withBodies = milestone.issues.map((i) => ({
    ref: String(i.number),
    title: i.title,
    body: i.body,
    url: i.url,
  }));

  const agentSelection = await resolveLocalAgentHarness({
    repoRoot,
    agent: mergeAgentSelections(globalAgent, localAgent),
  });

  console.log("Scoring issues for kickstart readiness...");
  const scoring = await runScoring(
    repoRoot,
    withBodies,
    [],
    agentSelection,
  );

  const scored = scoring.scored
    .filter((s) => !s.disqualified && s.score != null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  const disqualified = scoring.scored
    .filter((s) => s.disqualified)
    .map((s) => {
      const issue = withBodies.find((i) => i.ref === s.ref);
      return {
        ref: s.ref,
        title: issue?.title ?? s.ref,
        reason: s.reason ?? "No reason provided",
        url: issue?.url ??
          `https://github.com/${owner}/${repo}/issues/${s.ref}`,
      };
    });

  if (scored.length === 0 && disqualified.length === 0) {
    console.log("No issues scored - all were disqualified.");
    console.log("Make sure issues have clear acceptance criteria.");
    return;
  }

  const scoredItems = scored.map((s) => {
    const issue = withBodies.find((i) => i.ref === s.ref);
    return {
      ref: s.ref,
      title: issue?.title ?? s.ref,
      score: s.score,
      url: issue?.url ?? `https://github.com/${owner}/${repo}/issues/${s.ref}`,
    };
  });

  const { id, markdownPath, jsonPath } = getStackArtifactPaths(
    repoRoot,
    owner,
    repo,
    milestone.number,
  );

  let stackMode = resolveInitStackMode(config);
  const stackExists = await Deno.stat(markdownPath).then(() => true).catch(
    () => false,
  );

  if (stackExists) {
    if (stackMode === "create") {
      if (isUnattended()) {
        stackMode = "refresh";
      } else {
        stackMode = promptStackUpdateMode();
      }
    }
    if (stackMode === "overwrite") {
      const approved = confirmDestructiveOverwrite(
        markdownPath.replace(`${repoRoot}/`, ""),
        config.autoYes,
      );
      if (!approved) {
        throw new Error("Stack overwrite cancelled.");
      }
    }
  } else if (stackMode === "overwrite") {
    stackMode = "create";
  }

  try {
    await Deno.mkdir(`${repoRoot}/plans`, { recursive: true });
  } catch {
    // Directory may already exist
  }

  let content = formatPlanFile(
    milestone,
    owner,
    repo,
    scoredItems,
    disqualified,
    useIssueUrls,
  );

  if (stackMode === "refresh" && stackExists) {
    const existing = await Deno.readTextFile(markdownPath);
    content = mergeStackCheckmarks(content, existing);
    console.log("Preserved completed checklist items from the existing stack.");
  }

  await Deno.writeTextFile(markdownPath, content);

  await writeStackIndex(
    repoRoot,
    milestone,
    owner,
    repo,
    scoredItems,
    disqualified,
  );

  const actionLabel = stackMode === "create"
    ? "Created"
    : stackMode === "refresh"
    ? "Refreshed"
    : "Overwrote";
  console.log(`${actionLabel}: ${markdownPath}`);

  const publishMode = resolveInitStackPublishMode({
    publish: config.publish,
    defaultMode: isCI() ? "pr" : "none",
  });

  if (publishMode !== "none") {
    const message =
      `${actionLabel.toLowerCase()} ${owner}/${repo} milestone ${milestone.number} stack`;
    const publishResult = publishMode === "pr"
      ? await publishStackArtifactsPullRequest(
        repoRoot,
        [markdownPath, jsonPath],
        message,
        milestone.number,
        milestone.title,
      )
      : await commitStackArtifacts(
        repoRoot,
        [markdownPath, jsonPath],
        message,
      );
    await writeGithubActionVcsOutputs({
      ...publishResult,
      publishMode,
    });
    console.log(
      `Published stack artifacts to ${
        publishResult.prUrl ?? publishResult.branchName
      } (${publishResult.commitSha.slice(0, 7)}).`,
    );
  } else {
    console.log("");
    console.log("Next steps:");
    console.log(`  1. Review and commit the plan file:`);
    console.log(`     sl add plans/${id}.stack.md plans/${id}.stack.json`);
    console.log(
      `     sl commit -m "Add ${owner}/${repo} milestone ${milestone.number} stack"`,
    );
    console.log(
      `  2. Run 'dn kickstart --milestone ${milestone.number}' to start working`,
    );
    console.log("");
    console.log(
      "To refresh the milestone plan later, run:",
    );
    console.log(
      `  dn init stack ${milestone.number} --refresh`,
    );
    console.log("");
    console.log(
      "To trigger from a linked interface, commit this file to the repo.",
    );
  }
  Deno.exit(0);
}
