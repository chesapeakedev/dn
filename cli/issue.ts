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
  addIssueComment,
  closeIssue,
  createIssue,
  type CreateIssueOptions,
  getCurrentRepoFromRemote,
  getIssueWithComments,
  type IssueListItem,
  type IssueWithComments,
  listIssues,
  reopenIssue,
  updateIssue,
  type UpdateIssueOptions,
} from "../sdk/mod.ts";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parses an issue reference (number or URL) to extract issue number.
 */
function parseIssueRef(ref: string): number | null {
  // Handle #123 or 123
  const numMatch = ref.match(/^#?(\d+)$/);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }

  // Handle full URL
  const urlMatch = ref.match(
    /https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/,
  );
  if (urlMatch) {
    return parseInt(urlMatch[1], 10);
  }

  return null;
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

  const issueNumber = parseIssueRef(issueRef);
  if (!issueNumber) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  const { owner, repo } = await getCurrentRepoFromRemote();
  const issue = await getIssueWithComments(owner, repo, issueNumber);

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

  const issueNumber = parseIssueRef(issueRef);
  if (!issueNumber) {
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

  const { owner, repo } = await getCurrentRepoFromRemote();

  const options: UpdateIssueOptions = {};
  if (title !== undefined) options.title = title;
  if (body !== undefined) options.body = body;
  if (addLabels.length > 0) options.addLabels = addLabels;

  const result = await updateIssue(owner, repo, issueNumber, options);

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

  const issueNumber = parseIssueRef(issueRef);
  if (!issueNumber) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  const { owner, repo } = await getCurrentRepoFromRemote();

  // Add comment first if provided
  if (comment) {
    await addIssueComment(owner, repo, issueNumber, comment);
  }

  const result = await closeIssue(owner, repo, issueNumber, reason);

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

  const issueNumber = parseIssueRef(issueRef);
  if (!issueNumber) {
    console.error(`Error: Invalid issue reference: ${issueRef}`);
    Deno.exit(1);
  }

  const { owner, repo } = await getCurrentRepoFromRemote();

  // Add comment first if provided
  if (comment) {
    await addIssueComment(owner, repo, issueNumber, comment);
  }

  const result = await reopenIssue(owner, repo, issueNumber);

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

  const issueNumber = parseIssueRef(issueRef);
  if (!issueNumber) {
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

  const { owner, repo } = await getCurrentRepoFromRemote();
  const result = await addIssueComment(owner, repo, issueNumber, body);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Added comment to issue #${issueNumber}`);
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
  console.log("  comment   Add comment to an issue\n");
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
