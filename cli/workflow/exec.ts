// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join } from "@std/path";
import type { AgentHarness } from "../../sdk/github/agentHarness.ts";
import { githubApiUrl } from "../../sdk/github/endpoints.ts";
import { getDefaultBranch } from "../../sdk/github/github-gql.ts";
import { resolveStackMode } from "../../sdk/github/publish.ts";
import {
  getStackArtifactPaths,
  parseStackTodoItems,
} from "../../sdk/github/stack.ts";
import { resolveGitHubToken } from "../../sdk/github/token.ts";
import { parseFrontmatter } from "../../sdk/todo/frontmatter.ts";
import { firstUnchecked } from "../../sdk/todo/todo.ts";
import {
  loadWorkflowManifest,
  readDnWorkflowAgentConfig,
  requiredSecretForAgent,
  resolveManifestTemplate,
} from "../../sdk/workflows/mod.ts";

type CheckStatus = "passed" | "failed";

interface WorkflowCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

interface GitHubEvent {
  action?: unknown;
  client_payload?: unknown;
  inputs?: unknown;
}

/** Safe failure details rendered in a workflow summary. */
export interface WorkflowFailure {
  code: string;
  message: string;
  remediation?: string;
}

class WorkflowExecError extends Error implements WorkflowFailure {
  constructor(
    readonly code: string,
    message: string,
    readonly remediation?: string,
  ) {
    super(message);
  }
}

interface PullRequestRef {
  html_url: string;
  head: { ref: string };
}

/** Returns the open kickstart PR for an issue, when one is already in flight. */
export function openKickstartPullRequestUrl(
  pulls: PullRequestRef[],
  issueNumber: string,
): string | undefined {
  const prefix = `kickstart/issue_${issueNumber}_`;
  return pulls.find((pull) => pull.head.ref.startsWith(prefix))?.html_url;
}

/** Returns the open PR backed by an exact stable automation branch. */
export function openAutomationPullRequestUrl(
  pulls: PullRequestRef[],
  branchName: string,
): string | undefined {
  return pulls.find((pull) => pull.head.ref === branchName)?.html_url;
}

function sanitizeBranchPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-|-$/g,
    "",
  ).slice(0, 60) || "plan";
}

/** Stable topic branch used by the recurring todo workflow. */
export function todoLoopBranchName(planFile: string): string {
  return `dn/todo-loop-${sanitizeBranchPart(planFile)}`;
}

async function runGit(
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<Deno.CommandOutput> {
  const output = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success && !options.allowFailure) {
    const detail = new TextDecoder().decode(output.stderr).trim();
    throw new WorkflowExecError(
      "git_failed",
      `git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return output;
}

async function githubRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await resolveGitHubToken();
  return await fetch(githubApiUrl(path), {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
}

function githubRepository(): { owner: string; repo: string } {
  const repository = Deno.env.get("GITHUB_REPOSITORY") ?? "";
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) {
    throw new WorkflowExecError(
      "repository_missing",
      "GITHUB_REPOSITORY must contain owner/repo",
    );
  }
  return { owner, repo };
}

async function listOpenPullRequests(): Promise<PullRequestRef[]> {
  const { owner, repo } = githubRepository();
  const response = await githubRequest(
    `/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
  );
  if (!response.ok) {
    throw new WorkflowExecError(
      "pull_request_lookup_failed",
      `Could not list open pull requests: HTTP ${response.status}`,
    );
  }
  return await response.json() as PullRequestRef[];
}

async function findDailyKickstartPullRequest(
  workspace: string,
  milestone: string,
): Promise<string | undefined> {
  const { owner, repo } = githubRepository();
  const milestoneNumber = milestone.match(/(\d+)$/)?.[1];
  if (!milestoneNumber) return undefined;
  const stackPath = getStackArtifactPaths(
    workspace,
    owner,
    repo,
    Number(milestoneNumber),
  ).markdownPath;
  let content: string;
  try {
    content = await Deno.readTextFile(stackPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  const { body } = parseFrontmatter(content);
  const next = firstUnchecked({ meta: {}, items: parseStackTodoItems(body) });
  const issueNumber = next?.ref.match(/(\d+)$/)?.[1];
  if (!issueNumber) return undefined;
  return openKickstartPullRequestUrl(
    await listOpenPullRequests(),
    issueNumber,
  );
}

async function prepareTodoLoopBranch(
  branchName: string,
  hasOpenPullRequest: boolean,
): Promise<void> {
  if (hasOpenPullRequest) {
    await runGit(["fetch", "origin", branchName]);
    await runGit(["checkout", "-B", branchName, `origin/${branchName}`]);
  } else {
    await runGit(["checkout", "-B", branchName]);
  }
}

async function publishTodoLoopPullRequest(
  branchName: string,
  planFile: string,
  existingPrUrl: string | undefined,
): Promise<string | undefined> {
  await runGit(["add", "-A"]);
  const diff = await runGit(["diff", "--cached", "--quiet"], {
    allowFailure: true,
  });
  if (diff.success) return existingPrUrl;
  await runGit(["commit", "-m", `dn: advance ${planFile}`]);
  await runGit([
    "push",
    "-u",
    "--force-with-lease",
    "origin",
    `HEAD:${branchName}`,
  ]);
  if (existingPrUrl) return existingPrUrl;

  const { owner, repo } = githubRepository();
  const defaultBranch = await getDefaultBranch(owner, repo);
  const response = await githubRequest(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Advance ${planFile}`,
      body:
        `Recurring dn automation updates for \`${planFile}\`. Later runs advance this pull request until the plan is complete.`,
      head: branchName,
      base: defaultBranch,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new WorkflowExecError(
      "pull_request_create_failed",
      `Could not create pull request: HTTP ${response.status}: ${detail}`,
    );
  }
  return (await response.json() as PullRequestRef).html_url;
}

function recordCheck<Result>(
  checks: WorkflowCheck[],
  name: string,
  operation: () => { message: string; result: Result },
): Result {
  try {
    const { message, result } = operation();
    checks.push({ name, status: "passed", message });
    return result;
  } catch (error) {
    checks.push({
      name,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkflowExecError(
      "invalid_payload",
      `${label} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorkflowExecError(
      "invalid_payload",
      `${field} must be a non-empty string`,
    );
  }
  return value.trim();
}

function requireBoolean(
  value: unknown,
  field: string,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new WorkflowExecError(
      "invalid_payload",
      `${field} must be a boolean`,
    );
  }
  return value;
}

function requireMilestone(value: unknown, field: string): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    throw new WorkflowExecError(
      "invalid_payload",
      `${field} must be a milestone number or URL`,
    );
  }
  return String(value).trim();
}

/**
 * Exports denoise HTTP progress env from nested `client_payload.progress`.
 * Missing or incomplete progress leaves existing env unchanged (NullReporter).
 */
export function applyProgressEnvFromClientPayload(
  payload: Record<string, unknown>,
  setEnv: (key: string, value: string) => void = (key, value) =>
    Deno.env.set(key, value),
): boolean {
  const progress = payload.progress;
  if (typeof progress !== "object" || progress == null) return false;
  const record = progress as Record<string, unknown>;
  const mode = typeof record.mode === "string" ? record.mode.trim() : "";
  const url = typeof record.url === "string" ? record.url.trim() : "";
  const token = typeof record.token === "string" ? record.token.trim() : "";
  if (mode !== "http" || !url || !token) return false;
  setEnv("DN_PROGRESS", "http");
  setEnv("DN_PROGRESS_URL", url);
  setEnv("DN_PROGRESS_TOKEN", token);
  return true;
}

function resolveIssue(payload: Record<string, unknown>): string {
  const hasUrl = payload.issue_url !== undefined &&
    payload.issue_url !== null &&
    payload.issue_url !== "";
  const hasNumber = payload.issue_number !== undefined &&
    payload.issue_number !== null && payload.issue_number !== "";
  if (hasUrl === hasNumber) {
    throw new WorkflowExecError(
      "invalid_payload",
      "Provide exactly one of client_payload.issue_url or client_payload.issue_number",
    );
  }
  if (hasUrl) {
    const url = requireNonEmptyString(
      payload.issue_url,
      "client_payload.issue_url",
    );
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9]\d*$/.test(url)) {
      throw new WorkflowExecError(
        "invalid_payload",
        "client_payload.issue_url must be a GitHub issue URL",
      );
    }
    return url;
  }
  if (
    typeof payload.issue_number === "string" &&
    !/^[1-9]\d*$/.test(payload.issue_number)
  ) {
    throw new WorkflowExecError(
      "invalid_payload",
      "client_payload.issue_number must be a positive integer",
    );
  }
  const issueNumber = Number(payload.issue_number);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new WorkflowExecError(
      "invalid_payload",
      "client_payload.issue_number must be a positive integer",
    );
  }
  return String(issueNumber);
}

function validateDispatchEnvelope(
  event: GitHubEvent,
  expectedType: string,
): Record<string, unknown> {
  if (event.action !== expectedType) {
    throw new WorkflowExecError(
      "event_mismatch",
      `Expected repository_dispatch action ${expectedType}, received ${
        String(event.action)
      }`,
    );
  }
  const payload = requireRecord(event.client_payload, "client_payload");
  if (payload.schema_version !== "1.0") {
    throw new WorkflowExecError(
      "invalid_payload",
      "client_payload.schema_version must be 1.0",
    );
  }
  requireNonEmptyString(payload.dispatch_id, "client_payload.dispatch_id");
  return payload;
}

/** Resolve validated GitHub event data into the dn arguments to execute. */
export function resolveWorkflowArguments(
  workflowId: string,
  eventName: string,
  event: GitHubEvent,
  agent: AgentHarness,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): string[] {
  const prefix = ["--agent", agent];
  if (workflowId === "dn.daily_kickstart") {
    if (eventName !== "schedule" && eventName !== "workflow_dispatch") {
      throw new WorkflowExecError(
        "event_mismatch",
        `dn.daily_kickstart does not support event ${eventName}`,
      );
    }
    const inputs = event.inputs === undefined
      ? {}
      : requireRecord(event.inputs, "inputs");
    const milestone = requireMilestone(
      inputs.milestone || env.DN_DAILY_KICKSTART_MILESTONE,
      "milestone",
    );
    return [
      ...prefix,
      "kickstart",
      "--publish",
      "pr",
      "--milestone",
      milestone,
      "--once",
    ];
  }

  if (workflowId === "dn.todo_loop") {
    if (
      eventName !== "schedule" && eventName !== "workflow_dispatch" &&
      eventName !== "repository_dispatch"
    ) {
      throw new WorkflowExecError(
        "event_mismatch",
        `dn.todo_loop does not support event ${eventName}`,
      );
    }
    if (eventName === "repository_dispatch") {
      const payload = validateDispatchEnvelope(event, "dn.todo_loop");
      const planFile = requireNonEmptyString(
        payload.plan_file || env.DN_TODO_PLAN_PATH || "plans/todo.plan.md",
        "plan_file",
      );
      return [...prefix, "loop", planFile];
    }
    const inputs = event.inputs === undefined
      ? {}
      : requireRecord(event.inputs, "inputs");
    const planFile = requireNonEmptyString(
      inputs.plan_file || env.DN_TODO_PLAN_PATH || "plans/todo.plan.md",
      "plan_file",
    );
    return [...prefix, "loop", planFile];
  }

  if (eventName !== "repository_dispatch") {
    throw new WorkflowExecError(
      "event_mismatch",
      `${workflowId} requires repository_dispatch, received ${eventName}`,
    );
  }
  const dispatchType = workflowId === "dn.meld_issue_plan" &&
      event.action === "dn.prep_issue_plan"
    ? "dn.prep_issue_plan"
    : workflowId;
  const payload = validateDispatchEnvelope(event, dispatchType);
  requireBoolean(payload.validate_only, "client_payload.validate_only", false);

  if (workflowId === "dn.init_stack") {
    const milestone = requireMilestone(
      payload.milestone,
      "client_payload.milestone",
    );
    const stackMode = resolveStackMode({
      stackMode: payload.stack_mode,
      refresh: payload.refresh,
      defaultMode: "refresh",
    });
    const args = [...prefix, "init", "stack", milestone];
    if (stackMode === "refresh") {
      args.push("--refresh");
    } else if (stackMode === "overwrite") {
      args.push("--overwrite", "--yes");
    }
    if (
      payload.publish !== undefined &&
      (typeof payload.publish !== "string" ||
        payload.publish.trim().toLowerCase() !== "pr")
    ) {
      throw new WorkflowExecError(
        "invalid_payload",
        "client_payload.publish must be pr for canonical Actions dispatches",
      );
    }
    args.push("--publish", "pr");
    return args;
  }

  if (
    workflowId === "dn.meld_issue_plan" ||
    workflowId === "dn.prep_issue_plan"
  ) {
    // Actions is always unattended; GitHub issue targets require --yes / DN_YES.
    const args = [...prefix, "meld", "--yes"];
    if (payload.plan_name !== undefined && payload.plan_name !== "") {
      args.push(
        "--plan-name",
        requireNonEmptyString(payload.plan_name, "client_payload.plan_name"),
      );
    }
    const issue = resolveIssue(payload);
    args.push("--target", `github:issue:${issue}`, issue);
    return args;
  }

  if (workflowId === "dn.kickstart_issue") {
    if (
      payload.publish !== undefined &&
      (typeof payload.publish !== "string" ||
        payload.publish.trim().toLowerCase() !== "pr")
    ) {
      throw new WorkflowExecError(
        "invalid_payload",
        "client_payload.publish must be pr for canonical Actions dispatches",
      );
    }
    if (payload.awp !== undefined && payload.awp !== true) {
      throw new WorkflowExecError(
        "invalid_payload",
        "client_payload.awp must be true for canonical Actions dispatches",
      );
    }
    const args = [...prefix, "kickstart", "--publish", "pr"];
    args.push(resolveIssue(payload));
    return args;
  }

  throw new WorkflowExecError(
    "unsupported_workflow",
    `Workflow ${workflowId} has no execution mapping`,
  );
}

function annotationValue(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll(
    "\n",
    "%0A",
  );
}

function markdownValue(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll("|", "\\|").replaceAll("`", "\\`").replaceAll("\r", " ")
    .replaceAll("\n", " ").slice(0, 500);
}

/** Render the GitHub Actions job summary for a workflow execution. */
export function renderWorkflowSummary(options: {
  workflowId: string;
  eventName: string;
  agent?: AgentHarness;
  status: "passed" | "failed" | "validated";
  checks: WorkflowCheck[];
  error?: WorkflowFailure;
  args?: string[];
}): string {
  const icon = options.status === "failed" ? "❌" : "✅";
  const lines = [
    `## ${icon} dn workflow: ${markdownValue(options.workflowId)}`,
    "",
    `**Status:** ${options.status}`,
    `**Event:** \`${markdownValue(options.eventName)}\``,
  ];
  if (options.agent) lines.push(`**Agent:** \`${options.agent}\``);
  lines.push(
    "",
    "### Validation",
    "",
    "| Check | Result | Details |",
    "| --- | --- | --- |",
  );
  for (const check of options.checks) {
    lines.push(
      `| ${markdownValue(check.name)} | ${
        check.status === "passed" ? "✅ Passed" : "❌ Failed"
      } | ${markdownValue(check.message)} |`,
    );
  }
  if (options.error) {
    lines.push(
      "",
      "### Failure",
      "",
      `**${markdownValue(options.error.code)}:** ${
        markdownValue(options.error.message)
      }`,
    );
    if (options.error.remediation) {
      lines.push("", `Next step: ${markdownValue(options.error.remediation)}`);
    }
  } else if (options.args) {
    lines.push(
      "",
      "### Execution",
      "",
      `Command: \`dn ${options.args.map(markdownValue).join(" ")}\``,
    );
  }
  return lines.join("\n") + "\n";
}

async function writeSummary(content: string): Promise<void> {
  const path = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (path) await Deno.writeTextFile(path, content, { append: true });
}

async function writeActionOutputs(
  status: "passed" | "failed" | "validated",
  phase: string,
  workflowId: string,
  prUrl?: string,
): Promise<void> {
  const path = Deno.env.get("GITHUB_OUTPUT");
  if (!path) return;
  await Deno.writeTextFile(
    path,
    `status=${status}\nphase=${phase}\nworkflow=${workflowId}\n${
      prUrl ? `pr_url=${prUrl}\n` : ""
    }`,
    { append: true },
  );
}

async function installScript(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new WorkflowExecError(
      "agent_install_failed",
      `Could not download agent installer: HTTP ${response.status}`,
    );
  }
  const child = new Deno.Command("bash", {
    args: ["-s", "--"],
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(await response.text()));
  await writer.close();
  const status = await child.status;
  if (!status.success) {
    throw new WorkflowExecError(
      "agent_install_failed",
      `Agent installer exited with status ${status.code}`,
    );
  }
}

async function installAgent(agent: AgentHarness): Promise<void> {
  const home = Deno.env.get("HOME") ?? "";
  if (agent === "opencode") {
    await installScript("https://opencode.ai/install");
    Deno.env.set(
      "PATH",
      `${join(home, ".opencode/bin")}:${Deno.env.get("PATH") ?? ""}`,
    );
  } else if (agent === "claude") {
    await installScript("https://claude.ai/install.sh");
    Deno.env.set("CLAUDE_CODE_BARE", "1");
    Deno.env.set(
      "PATH",
      `${join(home, ".local/bin")}:${Deno.env.get("PATH") ?? ""}`,
    );
  } else if (agent === "cursor") {
    await installScript("https://cursor.com/install");
    Deno.env.set(
      "PATH",
      `${join(home, ".cursor/bin")}:${Deno.env.get("PATH") ?? ""}`,
    );
  } else if (agent === "codex") {
    await installScript("https://chatgpt.com/codex/install.sh");
    Deno.env.set(
      "PATH",
      `${join(home, ".local/bin")}:${Deno.env.get("PATH") ?? ""}`,
    );
  } else {
    await installScript("https://gh.io/copilot-install");
    Deno.env.set(
      "PATH",
      `${join(home, ".local/bin")}:${Deno.env.get("PATH") ?? ""}`,
    );
  }
}

async function executeDn(args: string[]): Promise<void> {
  const command = Deno.env.get("DN_EXECUTABLE") ?? "dn";
  const status = await new Deno.Command(command, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new WorkflowExecError(
      "workflow_failed",
      `dn exited with status ${status.code}`,
    );
  }
}

/** Execute a canonical dn workflow inside GitHub Actions. */
export async function handleWorkflowExec(args: string[]): Promise<void> {
  const validateOnly = args.includes("--validate-only");
  const positionals = args.filter((arg) => arg !== "--validate-only");
  const workflowId = positionals[0] ?? "";
  if (!workflowId || positionals.length > 1) {
    throw new Error(
      "Usage: dn workflows exec <workflow-id> [--validate-only]",
    );
  }

  const checks: WorkflowCheck[] = [];
  const eventName = Deno.env.get("GITHUB_EVENT_NAME") ?? "unknown";
  let agent: AgentHarness | undefined;
  let executionArgs: string[] | undefined;
  let failure: WorkflowExecError | undefined;
  let phase = "validation";

  try {
    recordCheck(checks, "Environment", () => {
      if (Deno.env.get("GITHUB_ACTIONS") !== "true") {
        throw new WorkflowExecError(
          "not_github_actions",
          "dn workflows exec must run in GitHub Actions",
        );
      }
      if (!Deno.env.get("GITHUB_WORKSPACE")) {
        throw new WorkflowExecError(
          "workspace_missing",
          "GITHUB_WORKSPACE is not set",
        );
      }
      return { message: "GitHub Actions environment detected", result: true };
    });

    const manifest = await loadWorkflowManifest();
    const template = recordCheck(checks, "Workflow", () => {
      const resolved = resolveManifestTemplate(workflowId, manifest);
      if (!resolved) {
        throw new WorkflowExecError(
          "unknown_workflow",
          `Unknown canonical workflow: ${workflowId}`,
        );
      }
      return { message: `Resolved ${workflowId}`, result: resolved };
    });

    const eventPath = Deno.env.get("GITHUB_EVENT_PATH") ?? "";
    let event: GitHubEvent;
    try {
      event = JSON.parse(await Deno.readTextFile(eventPath)) as GitHubEvent;
    } catch (error) {
      const failure = new WorkflowExecError(
        "event_unreadable",
        `Could not read GITHUB_EVENT_PATH: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      checks.push({
        name: "Event file",
        status: "failed",
        message: failure.message,
      });
      throw failure;
    }
    checks.push({
      name: "Event file",
      status: "passed",
      message: "Event JSON loaded",
    });
    if (eventName === "repository_dispatch") {
      const payload = requireRecord(event.client_payload, "client_payload");
      const dispatchId = requireNonEmptyString(
        payload.dispatch_id,
        "client_payload.dispatch_id",
      );
      Deno.env.set("DN_DISPATCH_ID", dispatchId);
      applyProgressEnvFromClientPayload(payload);
    }

    const workspace = Deno.env.get("GITHUB_WORKSPACE") ?? Deno.cwd();
    let config;
    try {
      config = await readDnWorkflowAgentConfig(workspace);
    } catch (error) {
      const failure = new WorkflowExecError(
        "agent_config_invalid",
        error instanceof Error ? error.message : String(error),
      );
      checks.push({
        name: "Agent config",
        status: "failed",
        message: failure.message,
      });
      throw failure;
    }
    recordCheck(checks, "Agent config", () => {
      if (!config) {
        throw new WorkflowExecError(
          "agent_config_missing",
          ".github/dn/config.json is missing",
          "Run dn init workflows --agent <agent> and commit the config file.",
        );
      }
      return { message: `Configured agent: ${config.agent}`, result: true };
    });
    if (!config) throw new Error("unreachable");
    agent = config.agent;

    executionArgs = recordCheck(checks, "Payload", () => ({
      message: "Inputs are valid",
      result: resolveWorkflowArguments(
        template.id,
        eventName,
        event,
        config.agent,
      ),
    }));

    const requiredSecret = requiredSecretForAgent(agent);
    recordCheck(checks, "Credential", () => {
      if (!Deno.env.get(requiredSecret)) {
        throw new WorkflowExecError(
          "agent_secret_missing",
          `Agent ${agent} requires ${requiredSecret}`,
          `Configure the ${requiredSecret} repository secret.`,
        );
      }
      return {
        message: `${requiredSecret} is available`,
        result: true,
      };
    });

    if (validateOnly) {
      await writeSummary(renderWorkflowSummary({
        workflowId,
        eventName,
        agent,
        status: "validated",
        checks,
        args: executionArgs,
      }));
      await writeActionOutputs("validated", phase, workflowId);
      return;
    }

    if (template.id === "dn.daily_kickstart") {
      const milestoneIndex = executionArgs.indexOf("--milestone");
      const milestone = executionArgs[milestoneIndex + 1] ?? "";
      const openPrUrl = await findDailyKickstartPullRequest(
        workspace,
        milestone,
      );
      if (openPrUrl) {
        checks.push({
          name: "Open pull request",
          status: "passed",
          message:
            `Skipped duplicate work while the implementation pull request remains open: ${openPrUrl}`,
        });
        await writeSummary(renderWorkflowSummary({
          workflowId,
          eventName,
          agent,
          status: "passed",
          checks,
          args: executionArgs,
        }));
        await writeActionOutputs(
          "passed",
          "awaiting-pull-request",
          workflowId,
          openPrUrl,
        );
        return;
      }
    }

    let todoBranch: string | undefined;
    let todoPlanFile: string | undefined;
    let todoPrUrl: string | undefined;
    if (template.id === "dn.todo_loop") {
      todoPlanFile = executionArgs.at(-1);
      if (!todoPlanFile) {
        throw new WorkflowExecError(
          "invalid_payload",
          "dn.todo_loop requires a plan file",
        );
      }
      todoBranch = todoLoopBranchName(todoPlanFile);
      todoPrUrl = openAutomationPullRequestUrl(
        await listOpenPullRequests(),
        todoBranch,
      );
      await prepareTodoLoopBranch(todoBranch, todoPrUrl !== undefined);
    }

    phase = "agent-install";
    await installAgent(agent);
    phase = "execution";
    await executeDn(executionArgs);
    if (todoBranch && todoPlanFile) {
      phase = "publish";
      todoPrUrl = await publishTodoLoopPullRequest(
        todoBranch,
        todoPlanFile,
        todoPrUrl,
      );
      checks.push({
        name: "Pull request",
        status: "passed",
        message: todoPrUrl
          ? `Advanced recurring pull request: ${todoPrUrl}`
          : "No repository changes to publish",
      });
    }
    await writeSummary(renderWorkflowSummary({
      workflowId,
      eventName,
      agent,
      status: "passed",
      checks,
      args: executionArgs,
    }));
    await writeActionOutputs("passed", phase, workflowId, todoPrUrl);
  } catch (error) {
    failure = error instanceof WorkflowExecError
      ? error
      : new WorkflowExecError(
        "workflow_exec_failed",
        error instanceof Error ? error.message : String(error),
      );
    if (checks.at(-1)?.status !== "failed") {
      checks.push({
        name: phase === "agent-install" ? "Agent installation" : "Execution",
        status: "failed",
        message: failure.message,
      });
    }
    console.error(
      `::error::${annotationValue(`${failure.code}: ${failure.message}`)}`,
    );
    await writeSummary(renderWorkflowSummary({
      workflowId,
      eventName,
      agent,
      status: "failed",
      checks,
      error: failure,
      args: executionArgs,
    }));
    await writeActionOutputs("failed", phase, workflowId);
  }

  if (failure) throw failure;
}
