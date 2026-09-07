// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn tidy - Groom the prioritized todo list (re-fetch, re-score, optional merge).
 */

import { $ } from "$dax";
import { runScoring } from "../kickstart/score.ts";
import {
  addIssueComment,
  closeIssue,
  createIssue,
  getCurrentRepoFromRemote,
  getIssueWithComments,
  listIssues,
} from "../sdk/github/github-gql.ts";
import { fetchIssueFromUrl } from "../sdk/github/issue.ts";
import {
  getTodoPath,
  readTodoList,
  type TodoItem,
  writeTodoList,
} from "../sdk/todo/todo.ts";
import type { AgentSelection } from "../sdk/github/agentHarness.ts";
import {
  extractAgentSelectionFromArgs,
  mergeAgentSelections,
} from "../sdk/github/agentHarness.ts";
import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import { resolveDnConfig } from "../sdk/config/resolve.ts";
import { ensureOpenCodePhaseConfig } from "../sdk/github/opencode.ts";

async function handleTidyAgent(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("dn tidy agent - Check agent harness configuration\n");
    console.log("Usage: dn tidy agent [--check | --fix]\n");
    console.log("Ensures phase config files for the resolved agent harness.");
    console.log("Supported harness: opencode");
    console.log("  --check  Report drift without changing files");
    console.log("  --fix    Create or patch files");
    console.log("With no flag, report-only mode is used without a TTY.");
    return;
  }

  const check = args.includes("--check");
  const fix = args.includes("--fix");
  if (check && fix) throw new Error("Use only one of --check or --fix.");
  const workspaceRoot = Deno.env.get("WORKSPACE_ROOT") ?? Deno.cwd();
  const config = await resolveDnConfig({ repoRoot: workspaceRoot });
  if (config.agent !== "opencode") {
    console.log(
      config.agent
        ? `dn tidy agent: ${config.agent} harness does not require checks.`
        : "dn tidy agent: no agent configured; nothing to check.",
    );
    return;
  }

  const checkOnly = check || !fix && !Deno.stdin.isTerminal();
  const phases = ["plan", "implement"] as const;
  let changesNeeded = false;
  for (const phase of phases) {
    const path = `${workspaceRoot}/opencode.${phase}.json`;
    const needed = await ensureOpenCodePhaseConfig(
      workspaceRoot,
      phase,
      checkOnly,
    );
    if (!needed) {
      console.log(`ok ${path}`);
    } else if (checkOnly) {
      console.log(`missing ${path}`);
      changesNeeded = true;
    } else {
      console.log(`fixed ${path}`);
    }
  }
  if (checkOnly && changesNeeded) {
    throw new Error("dn tidy agent --check found files that need changes.");
  }
}

function promptYesNo(message: string): boolean {
  const answer = prompt(message + " (y/n): ")?.trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

export async function handleTidy(
  args: string[],
  globalAgent: AgentSelection | null = null,
): Promise<void> {
  if (args[0] === "agent") {
    await handleTidyAgent(args.slice(1));
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("dn tidy - Groom the prioritized todo list\n");
    console.log("Usage: dn tidy [options]\n");
    console.log("  dn tidy agent [--check | --fix]\n");
    console.log(
      "Re-fetches recent open issues, scores them (Fibonacci 1–8), and updates ~/.dn/todo.md.",
    );
    console.log(
      "If the scorer suggests merges, you will be prompted to confirm each.",
    );
    console.log(
      "When EDITOR is set, opens the list in your editor after refresh.\n",
    );
    console.log("Options:");
    console.log("  --limit <n>   Max issues to fetch (default: 5)");
    console.log(
      "  --agent <agent>  <harness>:<model> (harness-only or optional :<thinking>)",
    );
    console.log("  --help, -h    Show this help");
    return;
  }

  let limit = 5;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && i + 1 < args.length) {
      limit = parseInt(args[i + 1], 10) || 5;
    }
  }

  const workspaceRoot = Deno.env.get("WORKSPACE_ROOT") ?? Deno.cwd();

  const { owner, repo } = await getCurrentRepoFromRemote();
  const issues = await listIssues(owner, repo, { state: "open", limit });
  const withBodies = await Promise.all(
    issues.map(async (i) => {
      const data = await fetchIssueFromUrl(i.url);
      return { ref: i.url, title: data.title, body: data.body };
    }),
  );

  const planPaths: { ref: string; title: string }[] = [];
  try {
    const plansDir = `${workspaceRoot}/plans`;
    const dir = await Deno.readDir(plansDir);
    for await (const e of dir) {
      if (e.isFile && e.name.endsWith(".plan.md")) {
        const path = `plans/${e.name}`;
        const content = await Deno.readTextFile(`${plansDir}/${e.name}`).catch(
          () => "",
        );
        const titleMatch = content.match(/^#\s+(.+)$/m);
        planPaths.push({ ref: path, title: titleMatch ? titleMatch[1] : path });
      }
    }
  } catch {
    // no plans dir
  }

  const { selection: localAgent } = extractAgentSelectionFromArgs(args);
  const agentSelection = await resolveLocalAgentHarness({
    repoRoot: workspaceRoot,
    agent: mergeAgentSelections(globalAgent, localAgent),
  });
  const scoring = await runScoring(
    workspaceRoot,
    withBodies,
    planPaths,
    agentSelection,
  );

  const scoredItems: TodoItem[] = scoring.scored
    .filter((s) => !s.disqualified && s.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((s) => {
      const issue = withBodies.find((i) => i.ref === s.ref) ??
        planPaths.find((p) => p.ref === s.ref);
      return {
        checked: false,
        score: s.score,
        ref: s.ref,
        title: issue?.title ?? s.reason,
      };
    });

  const existing = await readTodoList();
  const scoredRefs = new Set(scoredItems.map((i) => i.ref));
  const uncheckedExisting = existing.items.filter((i) => !i.checked);
  const existingOnly = uncheckedExisting.filter((i) => !scoredRefs.has(i.ref));
  const byScore = (a: TodoItem, b: TodoItem) =>
    (b.score ?? 99) - (a.score ?? 99);
  const reordered = [...scoredItems.sort(byScore), ...existingOnly];

  const updatedList = {
    meta: {
      ...existing.meta,
      repo: `${owner}/${repo}`,
      updated: new Date().toISOString().slice(0, 10),
    },
    items: [...existing.items.filter((i) => i.checked), ...reordered],
  };
  await writeTodoList(updatedList);
  console.log(
    `Updated ~/.dn/todo.md with ${reordered.length} unchecked item(s).`,
  );

  const suggestions = scoring.merge_suggestions ?? [];
  for (const merge of suggestions) {
    const intoRef = merge.into_ref;
    const mergeRefs = merge.merge_refs;
    if (!mergeRefs.length) continue;
    const allRefs = [intoRef, ...mergeRefs];
    const refsList = allRefs.join(", ");
    if (!promptYesNo(`Merge ${refsList} into one issue?`)) continue;

    let combinedTitle = "";
    let combinedBody = "";
    const toClose: number[] = [];

    for (const r of allRefs) {
      const num = r.match(/#?(\d+)/)?.[1];
      if (!num) continue;
      const issueNum = parseInt(num, 10);
      try {
        const issue = await getIssueWithComments(owner, repo, issueNum);
        if (!combinedTitle) combinedTitle = issue.title;
        combinedBody += `## #${issue.number}: ${issue.title}\n\n${
          issue.body ?? ""
        }\n\n`;
        toClose.push(issueNum);
      } catch {
        // skip
      }
    }
    combinedBody += `\nRefs: ${allRefs.join(", ")}`;

    const created = await createIssue(owner, repo, {
      title: combinedTitle || "Merged issue",
      body: combinedBody,
    });
    for (const num of toClose) {
      await addIssueComment(owner, repo, num, `Merged into #${created.number}`);
      await closeIssue(owner, repo, num, "COMPLETED");
    }
    console.log(`Created #${created.number}; closed #${toClose.join(", #")}.`);
  }

  const editor = Deno.env.get("EDITOR");
  if (!editor) {
    console.log(
      "Set EDITOR to open the list after refresh (e.g. EDITOR=code --wait dn tidy).",
    );
    return;
  }
  const todoPath = getTodoPath();
  const absPath = await Deno.realPath(todoPath).catch(() => todoPath);
  await $`sh -c '"$EDITOR" "$1"' _ ${absPath}`;
}
