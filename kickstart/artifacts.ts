// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Artifact generation for kickstart.
 * Creates workspace artifacts like AGENTS.md and Cursor IDE integration files.
 */

/**
 * Generates or updates AGENTS.md file for the workspace.
 * Uses opencode init as a base if available, then intelligently merges kickstart content.
 *
 * @param workspaceRoot - Root directory of the workspace
 * @param existingAgentsMd - Optional existing AGENTS.md content to merge with
 * @returns Generated AGENTS.md content
 */
export async function generateAgentsMd(
  workspaceRoot: string,
  existingAgentsMd?: string,
): Promise<string> {
  const relativeKickstartPath = await getRelativeKickstartPath(workspaceRoot);

  // Determine base content
  let baseContent: string;

  // Check if we should use opencode init
  const isMinimal = !existingAgentsMd || isMinimalAgentsMd(existingAgentsMd);

  if (isMinimal) {
    // Try to run opencode init first
    const opencodeContent = await runOpenCodeInit(workspaceRoot);
    if (opencodeContent) {
      baseContent = opencodeContent;
    } else if (existingAgentsMd) {
      // Use existing content even if minimal
      baseContent = existingAgentsMd;
    } else {
      // Fallback to minimal template
      return generateMinimalTemplate();
    }
  } else {
    // Use existing content as base
    baseContent = existingAgentsMd!;
  }

  // Merge kickstart content into base
  return mergeAgentsMd(baseContent, relativeKickstartPath);
}

/**
 * Creates a Cursor IDE rule file for kickstart subagent integration.
 *
 * @param workspaceRoot - Root directory of the workspace
 */
export async function createCursorRule(
  workspaceRoot: string,
): Promise<void> {
  const cursorDir = `${workspaceRoot}/.cursor`;
  const rulesDir = `${cursorDir}/rules`;
  const rulePath = `${rulesDir}/kickstart.mdc`;

  // Create .cursor directory if it doesn't exist
  try {
    await Deno.stat(cursorDir);
  } catch {
    await Deno.mkdir(cursorDir, { recursive: true });
  }

  // Create .cursor/rules directory if it doesn't exist
  try {
    await Deno.stat(rulesDir);
  } catch {
    await Deno.mkdir(rulesDir, { recursive: true });
  }

  // Determine the source path for the bundled kickstart.mdc template.
  // In compiled binaries, import.meta.dirname points to the directory
  // containing the executable; in development mode we fall back to the
  // workspace kickstart directory.
  let sourcePath: string | null = null;
  if (typeof import.meta.dirname !== "undefined") {
    sourcePath = `${import.meta.dirname}/kickstart.mdc`;
  } else {
    sourcePath = `${workspaceRoot}/kickstart/kickstart.mdc`;
  }

  let ruleContent: string;
  try {
    ruleContent = await Deno.readTextFile(sourcePath);
  } catch {
    // If reading the template fails for any reason, do not crash the run;
    // just skip creating the rule file.
    return;
  }

  await Deno.writeTextFile(rulePath, ruleContent);
}

/**
 * Gets the path to the kickstart binary.
 * Works in both compiled binary and development mode.
 */
function getKickstartPath(): string {
  // In compiled binary, use exec path
  try {
    return Deno.execPath();
  } catch {
    // Fallback: try to detect from import.meta
    const url = new URL(import.meta.url);
    if (url.protocol === "file:") {
      return url.pathname;
    }
    return "kickstart";
  }
}

/**
 * Gets the relative path to kickstart from the workspace root.
 */
async function getRelativeKickstartPath(
  workspaceRoot: string,
): Promise<string> {
  const kickstartPath = getKickstartPath();
  try {
    const workspacePath = await Deno.realPath(workspaceRoot);
    const kickstartRealPath = await Deno.realPath(kickstartPath);
    if (kickstartRealPath.startsWith(workspacePath)) {
      return "./" + kickstartRealPath.slice(workspacePath.length + 1);
    }
  } catch {
    // If path resolution fails, use original path
  }
  return kickstartPath;
}

/**
 * Structure representing parsed AGENTS.md sections.
 */
interface AgentsMdStructure {
  sections: Array<{
    name: string;
    level: number;
    content: string;
    startLine: number;
    endLine: number;
  }>;
  hasProjectOverview: boolean;
  hasBuildLintTest: boolean;
  hasKickstartSection: boolean;
  hasCursorRules: boolean;
  customSections: string[];
  rawContent: string;
}

/**
 * Runs opencode init to generate a base AGENTS.md file.
 * Returns the generated content or null if opencode is not available or fails.
 *
 * @param workspaceRoot - Root directory of the workspace
 * @returns Generated AGENTS.md content or null
 */
async function runOpenCodeInit(
  workspaceRoot: string,
): Promise<string | null> {
  // Check if opencode is available
  try {
    const checkCmd = new Deno.Command("opencode", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });
    await checkCmd.output();
  } catch {
    // opencode not available, return null
    return null;
  }

  // Backup existing AGENTS.md if it exists
  const agentsMdPath = `${workspaceRoot}/AGENTS.md`;
  let hadExistingFile = false;
  let backupPath: string | null = null;
  let originalContent: string | null = null;
  try {
    await Deno.stat(agentsMdPath);
    hadExistingFile = true;
    originalContent = await Deno.readTextFile(agentsMdPath);
    backupPath = `${agentsMdPath}.kickstart-backup`;
    await Deno.copyFile(agentsMdPath, backupPath);
  } catch {
    // No existing file, that's fine
  }

  try {
    // Run opencode init
    // Note: opencode init might be interactive, but we'll try non-interactive mode
    // If the command doesn't exist or fails, we'll fall back gracefully
    const cmd = new Deno.Command("opencode", {
      args: ["init"],
      cwd: workspaceRoot,
      stdout: "piped",
      stderr: "piped",
      stdin: "null", // Non-interactive
    });

    const output = await cmd.output();

    // Check if AGENTS.md was created or modified
    let newContent: string | null = null;
    try {
      newContent = await Deno.readTextFile(agentsMdPath);
      // If we had existing content and it's the same, opencode init didn't do anything
      if (hadExistingFile && originalContent === newContent) {
        // Clean up backup and return null to indicate no change
        if (backupPath) {
          try {
            await Deno.remove(backupPath);
          } catch {
            // Ignore cleanup errors
          }
        }
        return null; // No new content from opencode init
      }
    } catch {
      // File doesn't exist or can't be read
      if (!output.success) {
        // opencode init failed, restore backup if needed
        if (backupPath && hadExistingFile && originalContent) {
          try {
            await Deno.writeTextFile(agentsMdPath, originalContent);
            await Deno.remove(backupPath);
          } catch {
            // Ignore restore errors
          }
        }
        return null;
      }
      // If output was successful but file doesn't exist, that's odd but not an error
      return null;
    }

    if (!output.success || !newContent) {
      // opencode init failed or didn't create content, restore backup if needed
      if (backupPath && hadExistingFile && originalContent) {
        try {
          await Deno.writeTextFile(agentsMdPath, originalContent);
          await Deno.remove(backupPath);
        } catch {
          // Ignore restore errors
        }
      }
      return null;
    }

    // Clean up backup
    if (backupPath) {
      try {
        await Deno.remove(backupPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    return newContent;
  } catch (error) {
    // Error running opencode init, restore backup if needed
    if (backupPath && hadExistingFile && originalContent) {
      try {
        await Deno.writeTextFile(agentsMdPath, originalContent);
        await Deno.remove(backupPath);
      } catch {
        // Ignore restore errors
      }
    }
    // Log but don't throw - this is non-blocking
    // Only log if it's not just "command not found"
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!errorMsg.includes("not found") && !errorMsg.includes("No such file")) {
      console.warn(`Warning: Failed to run opencode init: ${errorMsg}`);
    }
    return null;
  }
}

/**
 * Parses AGENTS.md content into structured sections.
 *
 * @param content - The AGENTS.md content to parse
 * @returns Structured representation of the file
 */
function parseAgentsMd(content: string): AgentsMdStructure {
  const lines = content.split("\n");
  const sections: AgentsMdStructure["sections"] = [];
  let currentSection: {
    name: string;
    level: number;
    content: string;
    startLine: number;
    endLine: number;
  } | null = null;

  const standardSectionNames = [
    "Project Overview",
    "Build",
    "Linting",
    "Testing",
    "Imports",
    "Formatting",
    "TypeScript",
    "Naming",
    "Module",
    "Error",
    "Async",
    "Testing Guidelines",
    "Git",
    "Cursor",
    "Agent Expectations",
    "Using Kickstart",
    "Kickstart",
  ];

  let hasProjectOverview = false;
  let hasBuildLintTest = false;
  let hasKickstartSection = false;
  let hasCursorRules = false;
  const customSections: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }

      const level = headerMatch[1].length;
      const name = headerMatch[2].trim();
      const isStandard = standardSectionNames.some((std) => name.includes(std));

      // Track specific sections
      if (name.includes("Project Overview")) {
        hasProjectOverview = true;
      }
      if (
        name.includes("Build") || name.includes("Linting") ||
        name.includes("Testing")
      ) {
        hasBuildLintTest = true;
      }
      if (name.includes("Kickstart")) {
        hasKickstartSection = true;
      }
      if (name.includes("Cursor") || name.includes("Copilot")) {
        hasCursorRules = true;
      }

      if (!isStandard) {
        customSections.push(name);
      }

      currentSection = {
        name,
        level,
        content: line + "\n",
        startLine: i,
        endLine: i,
      };
    } else if (currentSection) {
      currentSection.content += line + "\n";
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.endLine = lines.length - 1;
    sections.push(currentSection);
  }

  return {
    sections,
    hasProjectOverview,
    hasBuildLintTest,
    hasKickstartSection,
    hasCursorRules,
    customSections,
    rawContent: content,
  };
}

/**
 * Checks if the kickstart section exists.
 *
 * @param content - The AGENTS.md content to check
 * @returns True if kickstart section exists
 */
function hasKickstartSection(content: string): boolean {
  const structure = parseAgentsMd(content);
  if (!structure.hasKickstartSection) {
    return false;
  }

  // Check if there's a section with "Kickstart" in its name
  // Note: We don't validate content because H3 subsections like "### Basic Usage"
  // and "### AWP Mode" are parsed as separate sections, so the parent H2 section
  // content won't contain the keywords we'd be looking for.
  const kickstartSection = structure.sections.find((s) =>
    s.name.includes("Kickstart")
  );

  return kickstartSection !== undefined;
}

/**
 * Generates the kickstart section content.
 */
function genDnSection(): string {
  return `## Using dn

Use \`dn\` when interacting with GitHub and local plan files. \`dn\` is the primary
interface to this repository's workflows. Prefer it over ad-hoc scripts when
preparing workspaces, iterating on plans, or coordinating changes.

Run \`dn\` with no arguments to discover available subcommands. For detailed
behavior and flags, see \`docs/subcommands.md\`.

### Usage

To print help:

\`\`\`bash
dn
\`\`\`

To implement a GitHub issue:

\`\`\`bash
dn kickstart <issue_url>
\`\`\`

### Integration

- Kickstart runs opencode in two phases: plan (read-only) and implement
- It automatically includes AGENTS.md and deno.json (or package.json) in prompts
- After implementation, it updates AGENTS.md and runs linting
- It can create branches, commit changes, and open draft PRs (AWP mode)

### Workflow

1. **Plan Phase**: Kickstart analyzes the issue and creates an implementation plan (read-only)
2. **Implement Phase**: Kickstart applies the changes to the codebase
3. **Linting**: Kickstart runs linting to improve code quality
4. **Artifacts**: Kickstart updates AGENTS.md with project guidelines
5. **VCS** (AWP mode): Kickstart creates branch, commits, and opens draft PR

### Managing GitHub Issues

Use \`dn issue\` to create, read, update, and comment on GitHub issues directly
from a conversation. Users can manage their repo's issues entirely through an
agent without leaving the terminal.

**Creating issues** — when you discover a bug, identify follow-up work, or the
user asks you to file a ticket:

\`\`\`bash
dn issue create --title "Brief descriptive title" --body-file description.md
dn issue create --title "Brief descriptive title" --body-stdin
\`\`\`

**Reading issues** — check current state before updating:

\`\`\`bash
dn issue show 123
\`\`\`

**Adding a comment** (append-only, preferred default):

\`\`\`bash
dn issue comment 123 --body-file update.md
dn issue comment 123 --body-stdin
\`\`\`

**Replacing the issue body** (only when the user explicitly asks):

\`\`\`bash
dn issue edit 123 --body-file revised.md
dn issue edit 123 --body-stdin
\`\`\`

When creating or updating issues, use structured Markdown:

\`\`\`md
## Summary
- ...

## Updated understanding
- ...

## Proposed next steps
- ...

## Open questions / risks
- ...
\`\`\`

Guidelines:

- Prefer \`comment\` (append-only) over \`edit\` (replaces body) unless the user
  explicitly asks to rewrite the issue description.
- Use \`dn issue show <ref>\` before editing to confirm current context.
- \`<ref>\` can be \`123\`, \`#123\`, or a full GitHub issue URL.
- Create new issues when new work is identified; comment on existing issues
  when refining understanding of work already tracked.
`;
}

/**
 * Intelligently merges kickstart content into existing AGENTS.md.
 * Preserves existing structure and only adds what's missing.
 *
 * @param baseContent - The base AGENTS.md content (from opencode init or existing file)
 * @param relativeKickstartPath - Relative path to kickstart binary
 * @returns Merged AGENTS.md content
 */
function mergeAgentsMd(
  baseContent: string,
  _relativeKickstartPath: string,
): string {
  const structure = parseAgentsMd(baseContent);
  const kickstartSection = genDnSection();
  let result = baseContent;

  // Update Cursor / Copilot Rules section if it exists but doesn't mention kickstart
  if (structure.hasCursorRules) {
    const cursorSection = structure.sections.find((s) =>
      s.name.includes("Cursor") || s.name.includes("Copilot")
    );
    if (cursorSection) {
      const sectionContent = cursorSection.content.toLowerCase();
      if (!sectionContent.includes("kickstart")) {
        // Add kickstart reference to Cursor Rules section
        const lines = result.split("\n");
        const sectionEndLine = cursorSection.endLine;
        // Find a good place to insert (after existing rules, before section end)
        let insertLine = sectionEndLine;
        for (let i = cursorSection.startLine; i <= sectionEndLine; i++) {
          if (lines[i].trim() === "" && i > cursorSection.startLine + 2) {
            insertLine = i;
            break;
          }
        }
        // Insert kickstart reference
        const beforeRule = lines.slice(0, insertLine).join("\n");
        const afterRule = lines.slice(insertLine).join("\n");
        const kickstartRule =
          "- If `.cursor/rules/kickstart.mdc` exists, follow kickstart subagent guidelines.";
        result = beforeRule + "\n" + kickstartRule + "\n" + afterRule;
      }
    }
  }

  // If kickstart section already exists and is complete, we're done
  if (hasKickstartSection(result)) {
    return result;
  }

  // Find the best place to insert the kickstart section
  // Prefer after "Cursor / Copilot Rules" or "Agent Expectations", before custom sections
  const updatedStructure = parseAgentsMd(result);
  let insertIndex = -1;

  // Look for standard sections to insert after
  const preferredInsertAfter = [
    "Agent Expectations",
    "Cursor",
    "Copilot",
    "Git",
    "Testing Guidelines",
  ];

  for (let i = updatedStructure.sections.length - 1; i >= 0; i--) {
    const section = updatedStructure.sections[i];
    if (
      preferredInsertAfter.some((name) => section.name.includes(name))
    ) {
      insertIndex = section.endLine + 1;
      break;
    }
  }

  // If no preferred section found, insert before first custom section
  if (insertIndex === -1 && updatedStructure.customSections.length > 0) {
    const firstCustomIndex = updatedStructure.sections.findIndex((s) =>
      updatedStructure.customSections.includes(s.name)
    );
    if (firstCustomIndex !== -1) {
      insertIndex = updatedStructure.sections[firstCustomIndex].startLine;
    }
  }

  // If still no good place, append at the end
  if (insertIndex === -1) {
    const lines = result.split("\n");
    // Remove trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.join("\n") + "\n\n" + kickstartSection;
  }

  // Insert the kickstart section
  const lines = result.split("\n");
  const before = lines.slice(0, insertIndex).join("\n");
  const after = lines.slice(insertIndex).join("\n");

  // Ensure proper spacing
  const spacing = after.trim().startsWith("#") ? "\n\n" : "\n";
  return before + spacing + kickstartSection + spacing + after;
}

/**
 * Checks if AGENTS.md is minimal and needs full generation.
 */
function isMinimalAgentsMd(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 500) {
    return true;
  }

  const structure = parseAgentsMd(content);
  // If it has fewer than 3 sections, consider it minimal
  if (structure.sections.length < 3) {
    return true;
  }

  // If it lacks key sections, consider it minimal
  if (!structure.hasProjectOverview && !structure.hasBuildLintTest) {
    return true;
  }

  return false;
}

/**
 * Generates a minimal AGENTS.md template with kickstart info.
 * Used as fallback when opencode init is not available.
 */
function generateMinimalTemplate(): string {
  return `# AGENTS.md

This file provides instructions for agentic coding agents operating in this repository.

${genDnSection()}`;
}
