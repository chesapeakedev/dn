// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Resolves {@link dn meld `--target`} specifications to a {@link MeldTargetKind}
 * and workspace-relative POSIX path when the output is file-backed.
 */

import * as path from "@std/path";

/** High-level classification of meld agent output destinations. */
export type MeldTargetKind =
  | "plan"
  | "readme"
  | "contributing"
  | "agents"
  | "markdown"
  | "github-issue"
  | "github-comment";

/** Parsed GitHub output target (`github:issue:*` / `github:comment:*`). */
export interface MeldGitHubTarget {
  variant: "issue" | "comment";
  /** Issue URL, `#123`, or bare number — suitable for {@link resolveIssueUrlInput}. */
  issueSpecifier: string;
}

/** Result of resolving a `--target` argument before plan-name prompting. */
export interface ParsedMeldTarget {
  /** When true, derive `plans/*.plan.md` via plan-name prompting (legacy default). */
  isDefaultPlan: boolean;
  kind: MeldTargetKind;
  /**
   * Workspace-relative path using `/` separators. Absent only for GitHub-only
   * targets; omitted when {@link isDefaultPlan} until plan path is picked.
   */
  workspaceRelativePath?: string;
  github?: MeldGitHubTarget;
}

const GITHUB_ISSUE_PREFIX = /^github:issue:/i;
const GITHUB_COMMENT_PREFIX = /^github:comment:/i;

function assertWithinWorkspace(
  workspaceRoot: string,
  targetArg: string,
): string {
  const wr = workspaceRoot.replace(/[/\\]+$/, "");
  const normalizedUser = targetArg.trim();
  const abs = path.isAbsolute(normalizedUser)
    ? path.normalize(normalizedUser)
    : path.normalize(path.join(wr, normalizedUser));

  const rel = path.relative(wr, abs);
  if (
    rel === ".." ||
    rel.startsWith(`..${path.SEPARATOR}`)
  ) {
    throw new Error(
      `Target path escapes workspace root: ${targetArg}`,
    );
  }
  if (rel === "") {
    return "";
  }
  return rel.replaceAll("\\", "/");
}

/**
 * Determines which `CONTRIBUTING.md` path exists or should be created.
 *
 * - Prefer `./CONTRIBUTING.md` when present.
 * - Else use `./docs/CONTRIBUTING.md` when present (read/merge existing).
 * - Else default writes go to `./CONTRIBUTING.md`.
 */
export async function resolveContributingMarkdownPath(
  workspaceRoot: string,
): Promise<string> {
  const rootFs = path.join(workspaceRoot, "CONTRIBUTING.md");
  const docsFs = path.join(workspaceRoot, "docs", "CONTRIBUTING.md");
  try {
    await Deno.stat(rootFs);
    return "CONTRIBUTING.md";
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
  }
  try {
    await Deno.stat(docsFs);
    return "docs/CONTRIBUTING.md";
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
  }
  return "CONTRIBUTING.md";
}

/**
 * Parses a `--target` CLI value into {@link ParsedMeldTarget}.
 *
 * When `targetRaw` is `null`, returns the legacy default-plan target.
 *
 * @param targetRaw - Value after `--target`, trimmed
 * @param workspaceRoot - Absolute workspace root
 */
export async function parseMeldTarget(
  targetRaw: string | null,
  workspaceRoot: string,
): Promise<ParsedMeldTarget> {
  if (targetRaw === null || targetRaw.trim() === "") {
    return {
      isDefaultPlan: true,
      kind: "plan",
    };
  }

  const t = targetRaw.trim();

  const issueMatch = t.match(GITHUB_ISSUE_PREFIX);
  if (issueMatch) {
    return {
      isDefaultPlan: false,
      kind: "github-issue",
      github: {
        variant: "issue",
        issueSpecifier: t.slice(issueMatch[0].length).trim(),
      },
    };
  }

  const commentMatch = t.match(GITHUB_COMMENT_PREFIX);
  if (commentMatch) {
    return {
      isDefaultPlan: false,
      kind: "github-comment",
      github: {
        variant: "comment",
        issueSpecifier: t.slice(commentMatch[0].length).trim(),
      },
    };
  }

  const wsRel = assertWithinWorkspace(workspaceRoot, t);
  const base = wsRel.split("/").pop() ?? wsRel;

  if (wsRel.endsWith(".plan.md") || wsRel.startsWith("plans/")) {
    return {
      isDefaultPlan: false,
      kind: "plan",
      workspaceRelativePath: wsRel,
    };
  }

  if (base === "README.md") {
    return {
      isDefaultPlan: false,
      kind: "readme",
      workspaceRelativePath: wsRel === "" ? "README.md" : wsRel,
    };
  }
  if (base === "AGENTS.md") {
    return {
      isDefaultPlan: false,
      kind: "agents",
      workspaceRelativePath: wsRel === "" ? "AGENTS.md" : wsRel,
    };
  }
  if (base === "CONTRIBUTING.md") {
    let rel = wsRel === "" ? "CONTRIBUTING.md" : wsRel;
    if (rel === "CONTRIBUTING.md") {
      rel = await resolveContributingMarkdownPath(workspaceRoot);
    }
    return {
      isDefaultPlan: false,
      kind: "contributing",
      workspaceRelativePath: rel,
    };
  }

  const lower = base.toLowerCase();
  if (!lower.endsWith(".md")) {
    throw new Error(
      `Meld non-plan targets must be markdown (.md): ${targetRaw}`,
    );
  }

  if (wsRel === "") {
    throw new Error(
      `Invalid meld target "${targetRaw}" (resolved empty path).`,
    );
  }

  return {
    isDefaultPlan: false,
    kind: "markdown",
    workspaceRelativePath: wsRel,
  };
}
