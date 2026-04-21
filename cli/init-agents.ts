// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { join } from "@std/path";

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
      if (currentSection) {
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }

      const level = headerMatch[1].length;
      const name = headerMatch[2].trim();
      const isStandard = standardSectionNames.some((std) => name.includes(std));

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

function hasKickstartSection(content: string): boolean {
  const structure = parseAgentsMd(content);
  if (!structure.hasKickstartSection) {
    return false;
  }

  const kickstartSection = structure.sections.find((s) =>
    s.name.includes("Kickstart")
  );

  return kickstartSection !== undefined;
}

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

To update AGENTS.md with dn instructions (run after cloning):

\`\`\`bash
dn init agents
\`\`\`

### Integration

- Kickstart runs opencode in two phases: plan (read-only) and implement
- It automatically includes AGENTS.md and deno.json (or package.json) in prompts
- After implementation, it runs linting
- It can create branches, commit changes, and open draft PRs (AWP mode)

### Workflow

1. **Plan Phase**: Kickstart analyzes the issue and creates an implementation plan (read-only)
2. **Implement Phase**: Kickstart applies the changes to the codebase
3. **Linting**: Kickstart runs linting to improve code quality
4. **Artifacts**: Kickstart generates Cursor rules if configured
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

function mergeAgentsMd(baseContent: string): string {
  const structure = parseAgentsMd(baseContent);
  const kickstartSection = genDnSection();
  let result = baseContent;

  if (structure.hasCursorRules) {
    const cursorSection = structure.sections.find((s) =>
      s.name.includes("Cursor") || s.name.includes("Copilot")
    );
    if (cursorSection) {
      const sectionContent = cursorSection.content.toLowerCase();
      if (!sectionContent.includes("kickstart")) {
        const lines = result.split("\n");
        const sectionEndLine = cursorSection.endLine;
        let insertLine = sectionEndLine;
        for (let i = cursorSection.startLine; i <= sectionEndLine; i++) {
          if (lines[i].trim() === "" && i > cursorSection.startLine + 2) {
            insertLine = i;
            break;
          }
        }
        const beforeRule = lines.slice(0, insertLine).join("\n");
        const afterRule = lines.slice(insertLine).join("\n");
        const kickstartRule =
          "- If \`.cursor/rules/kickstart.mdc\` exists, follow kickstart subagent guidelines.";
        result = beforeRule + "\n" + kickstartRule + "\n" + afterRule;
      }
    }
  }

  if (hasKickstartSection(result)) {
    return result;
  }

  const updatedStructure = parseAgentsMd(result);
  let insertIndex = -1;

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

  if (insertIndex === -1 && updatedStructure.customSections.length > 0) {
    const firstCustomIndex = updatedStructure.sections.findIndex((s) =>
      updatedStructure.customSections.includes(s.name)
    );
    if (firstCustomIndex !== -1) {
      insertIndex = updatedStructure.sections[firstCustomIndex].startLine;
    }
  }

  if (insertIndex === -1) {
    const lines = result.split("\n");
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.join("\n") + "\n\n" + kickstartSection;
  }

  const lines = result.split("\n");
  const before = lines.slice(0, insertIndex).join("\n");
  const after = lines.slice(insertIndex).join("\n");

  const spacing = after.trim().startsWith("#") ? "\n\n" : "\n";
  return before + spacing + kickstartSection + spacing + after;
}

function isMinimalAgentsMd(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 500) {
    return true;
  }

  const structure = parseAgentsMd(content);
  if (structure.sections.length < 3) {
    return true;
  }

  if (!structure.hasProjectOverview && !structure.hasBuildLintTest) {
    return true;
  }

  return false;
}

function generateMinimalTemplate(): string {
  return `# AGENTS.md

This file provides instructions for agentic coding agents operating in this repository.

${genDnSection()}`;
}

export async function handleInitAgents(args: string[]): Promise<void> {
  const workspaceRoot = Deno.cwd();

  const showHelp = args.includes("--help") || args.includes("-h");

  if (showHelp) {
    console.log("dn init agents - Update AGENTS.md with dn instructions\n");
    console.log("Usage:");
    console.log("  dn init agents\n");
    console.log("Description:");
    console.log(
      "  Updates the AGENTS.md file in the current directory with instructions",
    );
    console.log(
      "  for using dn CLI. If AGENTS.md doesn't exist, creates it.\n",
    );
    console.log("Options:");
    console.log("  --help, -h    Show this help message\n");
    console.log("Examples:");
    console.log("  dn init agents");
    Deno.exit(0);
  }

  const agentsMdPath = join(workspaceRoot, "AGENTS.md");

  let existingContent: string | undefined;
  let wasNewFile = false;

  try {
    existingContent = await Deno.readTextFile(agentsMdPath);
  } catch {
    wasNewFile = true;
  }

  let newContent: string;

  if (!existingContent || isMinimalAgentsMd(existingContent)) {
    newContent = generateMinimalTemplate();
  } else {
    newContent = mergeAgentsMd(existingContent);
  }

  await Deno.writeTextFile(agentsMdPath, newContent);

  if (wasNewFile) {
    console.log(`Created ${agentsMdPath} with dn instructions`);
  } else {
    console.log(`Updated ${agentsMdPath} with dn instructions`);
  }
}
