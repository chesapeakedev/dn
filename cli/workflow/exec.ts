// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join } from "@std/path";
import type { AgentHarness } from "../../sdk/github/agentHarness.ts";
import {
  resolveKickstartPublishMode,
  resolveStackMode,
} from "../../sdk/github/publish.ts";
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
    if (eventName !== "schedule" && eventName !== "workflow_dispatch") {
      throw new WorkflowExecError(
        "event_mismatch",
        `dn.todo_loop does not support event ${eventName}`,
      );
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
  const payload = validateDispatchEnvelope(event, workflowId);
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
    args.push("--publish", "direct");
    return args;
  }

  if (
    workflowId === "dn.meld_issue_plan" ||
    workflowId === "dn.prep_issue_plan"
  ) {
    const args = [...prefix, "meld"];
    if (payload.plan_name !== undefined && payload.plan_name !== "") {
      args.push(
        "--plan-name",
        requireNonEmptyString(payload.plan_name, "client_payload.plan_name"),
      );
    }
    args.push(resolveIssue(payload));
    return args;
  }

  if (workflowId === "dn.kickstart_issue") {
    const publish = resolveKickstartPublishMode({
      publish: payload.publish,
      awp: payload.awp,
      defaultMode: "pr",
    });
    const args = [...prefix, "kickstart", "--publish", publish];
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
): Promise<void> {
  const path = Deno.env.get("GITHUB_OUTPUT");
  if (!path) return;
  await Deno.writeTextFile(
    path,
    `status=${status}\nphase=${phase}\nworkflow=${workflowId}\n`,
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

    phase = "agent-install";
    await installAgent(agent);
    phase = "execution";
    await executeDn(executionArgs);
    await writeSummary(renderWorkflowSummary({
      workflowId,
      eventName,
      agent,
      status: "passed",
      checks,
      args: executionArgs,
    }));
    await writeActionOutputs("passed", phase, workflowId);
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
