// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn issue subcommand handler
 *
 * Provides CRUD operations for GitHub issues:
 *   dn issue list     - List issues
 *   dn issue show     - Show issue details
 *   dn issue create   - Create new issue
 *   dn issue edit     - Edit existing issue
 *   dn issue close    - Close an issue
 *   dn issue reopen   - Reopen an issue
 *   dn issue comment  - Add comment to issue
 */

import {
  addIssueBlockedBy,
  addIssueComment,
  addSubIssue,
  closeIssue,
  createIssue,
  type CreateIssueOptions,
  getCurrentRepoFromRemote,
  getIssueIdentifiers,
  getIssueWithComments,
  type IssueListItem,
  type IssueRelationshipReference,
  type IssueRelationshipSummary,
  type IssueWithComments,
  listIssues,
  removeIssueBlockedBy,
  removeSubIssue,
  reopenIssue,
  reprioritizeSubIssue,
  updateIssue,
  type UpdateIssueOptions,
} from "../sdk/mod.ts";

// ============================================================================
// Helpers
// ============================================================================

interface ResolvedIssueRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Resolve a user-facing issue reference into owner/repo/number coordinates.
 */
async function resolveIssueRef(ref: string): Promise<ResolvedIssueRef | null> {
  const numMatch = ref.match(/^#?(\d+)$/);
  if (numMatch) {
    const remote = await getCurrentRepoFromRemote();
    return {
      owner: remote.owner,
      repo: remote.repo,
      number: parseInt(numMatch[1], 10),
    };
  }

  const urlMatch = ref.match(
    /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/,
  );
  if (!urlMatch) {
    return null;
  }

  return {
    owner: urlMatch[1],
    repo: urlMatch[2],
    number: parseInt(urlMatch[3], 10),
  };
}

/**
 * Formats a date string for display.
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats an issue for list display.
 */
function formatIssueListItem(issue: IssueListItem): string {
  const stateIcon = issue.state === "OPEN" ? "○" : "●";
  const labels = issue.labels.length > 0 ? ` [${issue.labels.join(", ")}]` : "";
  return `${stateIcon} #${issue.number} ${issue.title}${labels}`;
}

/**
 * Formats an issue with full details.
 */
function formatIssueDetails(issue: IssueWithComments): string {
  const lines: string[] = [];

  const stateIcon = issue.state === "OPEN" ? "○ Open" : "● Closed";
  lines.push(`# ${issue.title}`);
  lines.push("");
  lines.push(`${stateIcon} · #${issue.number} · ${issue.url}`);
  lines.push(`Opened by @${issue.author} on ${formatDate(issue.createdAt)}`);

  if (issue.closedAt) {
    lines.push(`Closed on ${formatDate(issue.closedAt)}`);
  }

  if (issue.assignees.length > 0) {
    lines.push(`Assignees: ${issue.assignees.map((a) => `@${a}`).join(", ")}`);
  }

  if (issue.labels.length > 0) {
    lines.push(`Labels: ${issue.labels.join(", ")}`);
  }

  const relationshipLines = formatRelationshipDetails(issue);
  if (relationshipLines.length > 0) {
    lines.push("");
    lines.push(...relationshipLines);
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  if (issue.body) {
    lines.push(issue.body);
  } else {
    lines.push("(No description)");
  }

  if (issue.comments.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`## Comments (${issue.comments.length})`);

    for (const comment of issue.comments) {
      lines.push("");
      lines.push(`### @${comment.author} · ${formatDate(comment.createdAt)}`);
      lines.push("");
      lines.push(comment.body);
    }
  }

  return lines.join("\n");
}

function formatRelationshipDetails(issue: IssueWithComments): string[] {
  const lines: string[] = [];
  lines.push("Relationships:");
  lines.push(
    ...formatSingleRelationshipLine("  Parent", issue.relationships.parent),
  );
  lines.push(
    ...formatRelationshipGroupLines(
      "  Sub-issues",
      issue.relationships.subIssues,
      issue.relationships.subIssuesSummary,
    ),
  );
  lines.push(
    ...formatRelationshipGroupLines(
      "  Blocked by",
      issue.relationships.blockedBy,
      issue.relationships.blockedBySummary,
    ),
  );
  lines.push(
    ...formatRelationshipGroupLines(
      "  Blocking",
      issue.relationships.blocking,
      issue.relationships.blockingSummary,
    ),
  );
  lines.push(
    ...formatSingleRelationshipLine(
      "  Duplicate of",
      issue.relationships.duplicateOf,
    ),
  );
  return lines;
}

function formatSingleRelationshipLine(
  label: string,
  relationship: IssueRelationshipReference | null,
): string[] {
  if (!relationship) {
    return [`${label}: none`];
  }
  return [`${label}: ${formatRelationshipRef(relationship)}`];
}

function formatRelationshipGroupLines(
  label: string,
  relationships: IssueRelationshipReference[],
  summary: IssueRelationshipSummary,
): string[] {
  if (summary.totalCount === 0) {
    return [`${label}: none`];
  }

  const lines = [
    `${label}: ${summary.totalCount} total (${summary.openCount} open, ${summary.closedCount} closed)`,
  ];

  for (const relationship of relationships) {
    lines.push(`  - ${formatRelationshipRef(relationship)}`);
  }

  if (relationships.length < summary.totalCount) {
    lines.push(
      `  - ${summary.totalCount - relationships.length} more not shown`,
    );
  }

  return lines;
}

function formatRelationshipRef(
  relationship: IssueRelationshipReference,
): string {
  const repoPrefix = `${relationship.owner}/${relationship.repo}`;
  return `${repoPrefix}#${relationship.number} ${relationship.title} (${relationship.state.toLowerCase()})`;
}

// ============================================================================
// Subcommand Handlers
// ============================================================================

/**
 * dn issue list
 */
async function handleList(args: string[]): Promise<void> {
  let state: "open" | "closed" | "all" = "open";
  const labels: string[] = [];
  let limit = 30;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--state" && i + 1 < args.length) {
      const val = args[++i];
      if (val === "open" || val === "closed" || val === "all") {
        state = val;
      } else {
        console.error(`Invalid state: ${val}. Use: open, closed, all`);
        Deno.exit(1);
      }
    } else if (arg === "--label" && i + 1 < args.length) {
      labels.push(args[++i]);
    } else if (arg === "--limit" && i + 1 < args.length) {
      limit = parseInt(args[++i], 10);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      showListHelp();
      return;
    }
  }

  const { owner, repo } = await getCurrentRepoFromRemote();
  const issues = await listIssues(owner, repo, { state, labels, limit });

  if (json) {
    console.log(JSON.stringify(issues, null, 2));
  } else if (issues.length === 0) {
    console.log("No issues found.");
  } else {
    for (const issue of issues) {
      console.log(formatIssueListItem(issue));
    }
    console.log(`\nShowing ${issues.length} issue(s)`);
  }
}

function showListHelp(): void {
  console.log("dn issue list - List issues\n");
  console.log("Usage:");
  console.log("  dn issue list [options]\n");
  console.log("Options:");
  console.log("  --state <open|closed|all>   Filter by state (default: open)");
  console.log("  --label <name>              Filter by label (repeatable)");
  console.log("  --limit <n>                 Max results (default: 30)");
  console.log("  --json                      Output as JSON");
  console.log("  --help, -h                  Show this help message\n");
  console.log("Examples:");
  console.log("  dn issue list");
  console.log("  dn issue list --state closed --limit 10");
  console.log('  dn issue list --label bug --label "help wanted"');
}

/**
 * dn issue show
 */
async function handleShow(args: string[]): Promise<void> {
  let issueRef: string | null = null;
  let json = false;
  let showComments = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--no-comments") {
      showComments = false;
    } else if (arg === "--help" || arg === "-h") {
      showShowHelp();
      return;
    } else if (!arg.startsWith("--") && !issueRef) {
      issueRef = arg;
    }
  }

  if (!issueRef) {
    console.error("Error: Issue number or URL required");
    console.error("\nUsage: dn issue show <number>");
    Deno.exit(1);
  }

  const resolved = await resolveIssueRef(issueRef);
  if (!resolved) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  const issue = await getIssueWithComments(
    resolved.owner,
    resolved.repo,
    resolved.number,
  );

  if (!showComments) {
    issue.comments = [];
  }

  if (json) {
    console.log(JSON.stringify(issue, null, 2));
  } else {
    console.log(formatIssueDetails(issue));
  }
}

function showShowHelp(): void {
  console.log("dn issue show - Show issue details\n");
  console.log("Usage:");
  console.log("  dn issue show <number>\n");
  console.log("Arguments:");
  console.log("  <number>        Issue number or URL\n");
  console.log("Options:");
  console.log("  --json          Output as JSON");
  console.log("  --no-comments   Hide comments");
  console.log("  --help, -h      Show this help message\n");
  console.log("Examples:");
  console.log("  dn issue show 123");
  console.log("  dn issue show https://github.com/owner/repo/issues/123");
}

/**
 * dn issue create
 */
async function handleCreate(args: string[]): Promise<void> {
  let title: string | null = null;
  let body: string | null = null;
  let bodyFile: string | null = null;
  let bodyStdin = false;
  const labels: string[] = [];
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--title" && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === "--body") {
      console.error(
        "Error: --body is not supported. Use --body-file or --body-stdin",
      );
      Deno.exit(1);
    } else if (arg === "--body-file" && i + 1 < args.length) {
      bodyFile = args[++i];
    } else if (arg === "--body-stdin") {
      bodyStdin = true;
    } else if (arg === "--label" && i + 1 < args.length) {
      labels.push(args[++i]);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      showCreateHelp();
      return;
    }
  }

  if (!title) {
    console.error("Error: --title is required");
    console.error("\nUsage: dn issue create --title <title> [options]");
    Deno.exit(1);
  }

  if ((bodyFile ? 1 : 0) + (bodyStdin ? 1 : 0) > 1) {
    console.error("Error: Use only one of --body-file or --body-stdin");
    Deno.exit(1);
  }

  if (bodyFile) {
    try {
      body = await Deno.readTextFile(bodyFile);
    } catch (error) {
      console.error(
        `Error reading body file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      Deno.exit(1);
    }
  } else if (bodyStdin) {
    const buffer = await new Response(Deno.stdin.readable).arrayBuffer();
    body = new TextDecoder().decode(new Uint8Array(buffer));
  }

  const { owner, repo } = await getCurrentRepoFromRemote();

  const options: CreateIssueOptions = {
    title,
    body: body || undefined,
    labels: labels.length > 0 ? labels : undefined,
  };

  const result = await createIssue(owner, repo, options);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Created issue #${result.number}: ${result.title}`);
    console.log(result.url);
  }
}

function showCreateHelp(): void {
  console.log("dn issue create - Create a new issue\n");
  console.log("Usage:");
  console.log("  dn issue create --title <title> [options]\n");
  console.log("Options:");
  console.log("  --title <title>       Issue title (required)");
  console.log("  --body <body>         Issue body");
  console.log("  --body-file <path>    Read body from file");
  console.log("  --label <name>        Add label (repeatable)");
  console.log("  --json                Output as JSON");
  console.log("  --help, -h            Show this help message\n");
  console.log("Examples:");
  console.log('  dn issue create --title "Bug report"');
  console.log(
    '  dn issue create --title "Feature request" --body "Please add..."',
  );
  console.log(
    '  dn issue create --title "Fix needed" --label bug --label urgent',
  );
}

/**
 * dn issue edit
 */
async function handleEdit(args: string[]): Promise<void> {
  let issueRef: string | null = null;
  let title: string | undefined;
  let body: string | undefined;
  let bodyFile: string | null = null;
  let bodyStdin = false;
  const addLabels: string[] = [];
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--title" && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === "--body") {
      console.error(
        "Error: --body is not supported. Use --body-file or --body-stdin",
      );
      Deno.exit(1);
    } else if (arg === "--body-file" && i + 1 < args.length) {
      bodyFile = args[++i];
    } else if (arg === "--body-stdin") {
      bodyStdin = true;
    } else if (arg === "--add-label" && i + 1 < args.length) {
      addLabels.push(args[++i]);
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      showEditHelp();
      return;
    } else if (!arg.startsWith("--") && !issueRef) {
      issueRef = arg;
    }
  }

  if (!issueRef) {
    console.error("Error: Issue number required");
    console.error("\nUsage: dn issue edit <number> [options]");
    Deno.exit(1);
  }

  const resolved = await resolveIssueRef(issueRef);
  if (!resolved) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  if ((bodyFile ? 1 : 0) + (bodyStdin ? 1 : 0) > 1) {
    console.error("Error: Use only one of --body-file or --body-stdin");
    Deno.exit(1);
  }
  if (bodyFile) {
    try {
      body = await Deno.readTextFile(bodyFile);
    } catch (error) {
      console.error(
        `Error reading body file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      Deno.exit(1);
    }
  } else if (bodyStdin) {
    const buffer = await new Response(Deno.stdin.readable).arrayBuffer();
    body = new TextDecoder().decode(new Uint8Array(buffer));
  }

  if (!title && !body && addLabels.length === 0) {
    console.error(
      "Error: At least one of --title, --body, or --add-label required",
    );
    Deno.exit(1);
  }

  const options: UpdateIssueOptions = {};
  if (title !== undefined) options.title = title;
  if (body !== undefined) options.body = body;
  if (addLabels.length > 0) options.addLabels = addLabels;

  const result = await updateIssue(
    resolved.owner,
    resolved.repo,
    resolved.number,
    options,
  );

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Updated issue #${result.number}: ${result.title}`);
    console.log(result.url);
  }
}

function showEditHelp(): void {
  console.log("dn issue edit - Edit an existing issue\n");
  console.log("Usage:");
  console.log("  dn issue edit <number> [options]\n");
  console.log("Arguments:");
  console.log("  <number>              Issue number\n");
  console.log("Options:");
  console.log("  --title <title>       New title");
  console.log("  --body-file <path>    Read body from file");
  console.log("  --body-stdin          Read body from stdin");
  console.log("  --add-label <name>    Add label (repeatable)");
  console.log("  --json                Output as JSON");
  console.log("  --help, -h            Show this help message\n");
  console.log("Examples:");
  console.log('  dn issue edit 123 --title "Updated title"');
  console.log("  dn issue edit 123 --add-label bug");
}

/**
 * dn issue close
 */
async function handleClose(args: string[]): Promise<void> {
  let issueRef: string | null = null;
  let comment: string | null = null;
  let reason: "COMPLETED" | "NOT_PLANNED" | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--comment" && i + 1 < args.length) {
      comment = args[++i];
    } else if (arg === "--reason" && i + 1 < args.length) {
      const val = args[++i].toUpperCase();
      if (val === "COMPLETED" || val === "NOT_PLANNED") {
        reason = val;
      } else {
        console.error(`Invalid reason: ${val}. Use: completed, not_planned`);
        Deno.exit(1);
      }
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      showCloseHelp();
      return;
    } else if (!arg.startsWith("--") && !issueRef) {
      issueRef = arg;
    }
  }

  if (!issueRef) {
    console.error("Error: Issue number required");
    console.error("\nUsage: dn issue close <number> [options]");
    Deno.exit(1);
  }

  const resolved = await resolveIssueRef(issueRef);
  if (!resolved) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  // Add comment first if provided
  if (comment) {
    await addIssueComment(
      resolved.owner,
      resolved.repo,
      resolved.number,
      comment,
    );
  }

  const result = await closeIssue(
    resolved.owner,
    resolved.repo,
    resolved.number,
    reason,
  );

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Closed issue #${result.number}`);
    console.log(result.url);
  }
}

function showCloseHelp(): void {
  console.log("dn issue close - Close an issue\n");
  console.log("Usage:");
  console.log("  dn issue close <number> [options]\n");
  console.log("Arguments:");
  console.log("  <number>                    Issue number\n");
  console.log("Options:");
  console.log("  --comment <text>            Add comment before closing");
  console.log("  --reason <completed|not_planned>  Close reason");
  console.log("  --json                      Output as JSON");
  console.log("  --help, -h                  Show this help message\n");
  console.log("Examples:");
  console.log("  dn issue close 123");
  console.log('  dn issue close 123 --comment "Fixed in #456"');
  console.log("  dn issue close 123 --reason not_planned");
}

/**
 * dn issue reopen
 */
async function handleReopen(args: string[]): Promise<void> {
  let issueRef: string | null = null;
  let comment: string | null = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--comment" && i + 1 < args.length) {
      comment = args[++i];
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      showReopenHelp();
      return;
    } else if (!arg.startsWith("--") && !issueRef) {
      issueRef = arg;
    }
  }

  if (!issueRef) {
    console.error("Error: Issue number required");
    console.error("\nUsage: dn issue reopen <number> [options]");
    Deno.exit(1);
  }

  const resolved = await resolveIssueRef(issueRef);
  if (!resolved) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  // Add comment first if provided
  if (comment) {
    await addIssueComment(
      resolved.owner,
      resolved.repo,
      resolved.number,
      comment,
    );
  }

  const result = await reopenIssue(
    resolved.owner,
    resolved.repo,
    resolved.number,
  );

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Reopened issue #${result.number}`);
    console.log(result.url);
  }
}

function showReopenHelp(): void {
  console.log("dn issue reopen - Reopen a closed issue\n");
  console.log("Usage:");
  console.log("  dn issue reopen <number> [options]\n");
  console.log("Arguments:");
  console.log("  <number>            Issue number\n");
  console.log("Options:");
  console.log("  --comment <text>    Add comment when reopening");
  console.log("  --json              Output as JSON");
  console.log("  --help, -h          Show this help message\n");
  console.log("Examples:");
  console.log("  dn issue reopen 123");
  console.log(
    '  dn issue reopen 123 --comment "Reopening for further discussion"',
  );
}

/**
 * dn issue comment
 */
async function handleComment(args: string[]): Promise<void> {
  let issueRef: string | null = null;
  let body: string | null = null;
  let bodyFile: string | null = null;
  let bodyStdin = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--body") {
      console.error(
        "Error: --body is not supported. Use --body-file or --body-stdin",
      );
      Deno.exit(1);
    } else if (arg === "--body-file" && i + 1 < args.length) {
      bodyFile = args[++i];
    } else if (arg === "--body-stdin") {
      bodyStdin = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      showCommentHelp();
      return;
    } else if (!arg.startsWith("--") && !issueRef) {
      issueRef = arg;
    }
  }

  if (!issueRef) {
    console.error("Error: Issue number required");
    console.error("\nUsage: dn issue comment <number> --body <text>");
    Deno.exit(1);
  }

  const resolved = await resolveIssueRef(issueRef);
  if (!resolved) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  if ((bodyFile ? 1 : 0) + (bodyStdin ? 1 : 0) > 1) {
    console.error("Error: Use only one of --body-file or --body-stdin");
    Deno.exit(1);
  }
  if (bodyFile) {
    try {
      body = await Deno.readTextFile(bodyFile);
    } catch (error) {
      console.error(
        `Error reading body file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      Deno.exit(1);
    }
  } else if (bodyStdin) {
    const buffer = await new Response(Deno.stdin.readable).arrayBuffer();
    body = new TextDecoder().decode(new Uint8Array(buffer));
  }

  if (!body) {
    console.error("Error: --body-file or --body-stdin required");
    console.error(
      "\nUsage: dn issue comment <number> --body-file <path> | --body-stdin",
    );
    Deno.exit(1);
  }

  const result = await addIssueComment(
    resolved.owner,
    resolved.repo,
    resolved.number,
    body,
  );

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Added comment to issue #${resolved.number}`);
    console.log(result.url);
  }
}

function showCommentHelp(): void {
  console.log("dn issue comment - Add comment to an issue\n");
  console.log("Usage:");
  console.log("  dn issue comment <number> --body <text>\n");
  console.log("Arguments:");
  console.log("  <number>              Issue number\n");
  console.log("Options:");
  console.log("  --body-file <path>    Read body from file");
  console.log("  --body-stdin          Read body from stdin");
  console.log("  --json                Output as JSON");
  console.log("  --help, -h            Show this help message\n");
  console.log("Examples:");
  console.log('  dn issue comment 123 --body "Thanks for the report!"');
  console.log("  dn issue comment 123 --body-file response.md");
}

/**
 * dn issue relationship
 */
async function handleRelationship(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showRelationshipHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
      await handleRelationshipList(subArgs);
      return;
    case "add":
      await handleRelationshipAdd(subArgs);
      return;
    case "remove":
      await handleRelationshipRemove(subArgs);
      return;
    case "reprioritize":
      await handleRelationshipReprioritize(subArgs);
      return;
    case "mark-duplicate":
      await handleRelationshipMarkDuplicate(subArgs);
      return;
    default:
      console.error(`Unknown relationship subcommand: ${subcommand}\n`);
      showRelationshipHelp();
      Deno.exit(1);
  }
}

async function handleRelationshipList(args: string[]): Promise<void> {
  let issueRef: string | null = null;
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("--") && !issueRef) {
      issueRef = arg;
    }
  }

  if (!issueRef) {
    console.error("Error: Issue number or URL required");
    Deno.exit(1);
  }

  const resolved = await resolveIssueRef(issueRef);
  if (!resolved) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  const issue = await getIssueWithComments(
    resolved.owner,
    resolved.repo,
    resolved.number,
  );

  if (json) {
    console.log(JSON.stringify(issue.relationships, null, 2));
  } else {
    console.log(formatRelationshipDetails(issue).join("\n"));
  }
}

async function handleRelationshipAdd(args: string[]): Promise<void> {
  const kind = args[0];
  if (!kind) {
    console.error("Error: Relationship kind required");
    Deno.exit(1);
  }

  if (kind === "blocked-by") {
    await mutateBlockedByRelationship(args.slice(1), "add");
    return;
  }

  if (kind === "sub-issue") {
    await mutateSubIssueRelationship(args.slice(1), "add");
    return;
  }

  console.error(`Unsupported relationship kind: ${kind}`);
  Deno.exit(1);
}

async function handleRelationshipRemove(args: string[]): Promise<void> {
  const kind = args[0];
  if (!kind) {
    console.error("Error: Relationship kind required");
    Deno.exit(1);
  }

  if (kind === "blocked-by") {
    await mutateBlockedByRelationship(args.slice(1), "remove");
    return;
  }

  if (kind === "sub-issue") {
    await mutateSubIssueRelationship(args.slice(1), "remove");
    return;
  }

  console.error(`Unsupported relationship kind: ${kind}`);
  Deno.exit(1);
}

async function mutateBlockedByRelationship(
  args: string[],
  operation: "add" | "remove",
): Promise<void> {
  const issueRef = args[0];
  const targetRef = args[1];
  if (!issueRef || !targetRef) {
    console.error(
      `Usage: dn issue relationship ${operation} blocked-by <issue> <target>`,
    );
    Deno.exit(1);
  }

  const issue = await resolveIssueRef(issueRef);
  const target = await resolveIssueRef(targetRef);
  if (!issue || !target) {
    console.error("Error: Invalid issue reference");
    Deno.exit(1);
  }

  if (operation === "add") {
    await addIssueBlockedBy(
      issue.owner,
      issue.repo,
      issue.number,
      target.owner,
      target.repo,
      target.number,
    );
    console.log(
      `Added blocked-by relationship: #${issue.number} <- #${target.number}`,
    );
    return;
  }

  await removeIssueBlockedBy(
    issue.owner,
    issue.repo,
    issue.number,
    target.owner,
    target.repo,
    target.number,
  );
  console.log(
    `Removed blocked-by relationship: #${issue.number} <- #${target.number}`,
  );
}

async function mutateSubIssueRelationship(
  args: string[],
  operation: "add" | "remove",
): Promise<void> {
  const parentRef = args[0];
  const childRef = args[1];
  let replaceParent = false;

  for (const arg of args.slice(2)) {
    if (arg === "--replace-parent") {
      replaceParent = true;
    }
  }

  if (!parentRef || !childRef) {
    console.error(
      `Usage: dn issue relationship ${operation} sub-issue <parent> <child>`,
    );
    Deno.exit(1);
  }

  const parent = await resolveIssueRef(parentRef);
  const child = await resolveIssueRef(childRef);
  if (!parent || !child) {
    console.error("Error: Invalid issue reference");
    Deno.exit(1);
  }

  if (operation === "add") {
    await addSubIssue(
      parent.owner,
      parent.repo,
      parent.number,
      child.owner,
      child.repo,
      child.number,
      { replaceParent },
    );
    console.log(
      `Added sub-issue relationship: #${parent.number} -> #${child.number}`,
    );
    return;
  }

  await removeSubIssue(
    parent.owner,
    parent.repo,
    parent.number,
    child.owner,
    child.repo,
    child.number,
  );
  console.log(
    `Removed sub-issue relationship: #${parent.number} -> #${child.number}`,
  );
}

async function handleRelationshipReprioritize(args: string[]): Promise<void> {
  const kind = args[0];
  const parentRef = args[1];
  const childRef = args[2];
  let afterRef: string | null = null;

  for (let i = 3; i < args.length; i++) {
    if (args[i] === "--after" && i + 1 < args.length) {
      afterRef = args[++i];
    }
  }

  if (kind !== "sub-issue" || !parentRef || !childRef || !afterRef) {
    console.error(
      "Usage: dn issue relationship reprioritize sub-issue <parent> <child> --after <sibling>",
    );
    Deno.exit(1);
  }

  const parent = await resolveIssueRef(parentRef);
  const child = await resolveIssueRef(childRef);
  const sibling = await resolveIssueRef(afterRef);
  if (!parent || !child || !sibling) {
    console.error("Error: Invalid issue reference");
    Deno.exit(1);
  }

  const siblingIssue = await getIssueIdentifiers(
    sibling.owner,
    sibling.repo,
    sibling.number,
  );

  await reprioritizeSubIssue(
    parent.owner,
    parent.repo,
    parent.number,
    child.owner,
    child.repo,
    child.number,
    { afterIssueId: siblingIssue.databaseId },
  );
  console.log(
    `Moved sub-issue #${child.number} after #${sibling.number} under #${parent.number}`,
  );
}

async function handleRelationshipMarkDuplicate(args: string[]): Promise<void> {
  const issueRef = args[0];
  const canonicalRef = args[1];
  if (!issueRef || !canonicalRef) {
    console.error(
      "Usage: dn issue relationship mark-duplicate <issue> <canonical>",
    );
    Deno.exit(1);
  }

  const issue = await resolveIssueRef(issueRef);
  const canonical = await resolveIssueRef(canonicalRef);
  if (!issue || !canonical) {
    console.error("Error: Invalid issue reference");
    Deno.exit(1);
  }

  const canonicalBody =
    canonical.owner === issue.owner && canonical.repo === issue.repo
      ? `Duplicate of #${canonical.number}`
      : `Duplicate of ${canonical.owner}/${canonical.repo}#${canonical.number}`;

  await addIssueComment(issue.owner, issue.repo, issue.number, canonicalBody);
  console.log(
    `Marked issue #${issue.number} as a duplicate of #${canonical.number}`,
  );
}

function showRelationshipHelp(): void {
  console.log("dn issue relationship - Manage issue relationships\n");
  console.log("Usage:");
  console.log("  dn issue relationship <subcommand> [options]\n");
  console.log("Subcommands:");
  console.log(
    "  list <issue>                                     Show relationship metadata",
  );
  console.log("  add blocked-by <issue> <target>                  Add blocker");
  console.log(
    "  remove blocked-by <issue> <target>               Remove blocker",
  );
  console.log(
    "  add sub-issue <parent> <child> [--replace-parent] Add sub-issue",
  );
  console.log(
    "  remove sub-issue <parent> <child>                Remove sub-issue",
  );
  console.log("  reprioritize sub-issue <parent> <child> --after <sibling>");
  console.log(
    "  mark-duplicate <issue> <canonical>               Mark duplicate via comment",
  );
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Shows main help for issue subcommand.
 */
function showHelp(): void {
  console.log("dn issue - Manage GitHub issues\n");
  console.log("Usage:");
  console.log("  dn issue <subcommand> [options]\n");
  console.log("Subcommands:");
  console.log("  list      List issues");
  console.log("  show      Show issue details");
  console.log("  create    Create a new issue");
  console.log("  edit      Edit an existing issue");
  console.log("  close     Close an issue");
  console.log("  reopen    Reopen a closed issue");
  console.log("  comment   Add comment to an issue");
  console.log("  relationship  Manage issue relationships\n");
  console.log(
    "Use 'dn issue <subcommand> --help' for subcommand-specific options.",
  );
}

/**
 * Main handler for the issue subcommand.
 */
export async function handleIssue(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  try {
    switch (subcommand) {
      case "list":
      case "ls":
        await handleList(subArgs);
        break;
      case "show":
      case "view":
        await handleShow(subArgs);
        break;
      case "create":
      case "new":
        await handleCreate(subArgs);
        break;
      case "edit":
      case "update":
        await handleEdit(subArgs);
        break;
      case "close":
        await handleClose(subArgs);
        break;
      case "reopen":
        await handleReopen(subArgs);
        break;
      case "comment":
        await handleComment(subArgs);
        break;
      case "relationship":
      case "relationships":
        await handleRelationship(subArgs);
        break;
      default:
        console.error(`Unknown subcommand: ${subcommand}\n`);
        showHelp();
        Deno.exit(1);
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}
