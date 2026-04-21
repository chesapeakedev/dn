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
  hasDnSection: boolean;
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
    "Using dn",
    "Using Kickstart",
    "Kickstart",
  ];

  let hasProjectOverview = false;
  let hasBuildLintTest = false;
  let hasDnSection = false;
  let hasCursorRules = false;
  const customSections: string[] = [];
  let activeFenceMarker: "```" | "~~~" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trimStart();
    const fenceMatch = trimmedLine.match(/^(```|~~~)/);
    const headerMatch = activeFenceMarker === null
      ? line.match(/^(#{1,6})\s+(.+)$/)
      : null;
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
      if (name.includes("Using dn") || name.includes("Kickstart")) {
        hasDnSection = true;
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

    if (fenceMatch) {
      const fenceMarker = fenceMatch[1] as "```" | "~~~";
      if (activeFenceMarker === fenceMarker) {
        activeFenceMarker = null;
      } else if (activeFenceMarker === null) {
        activeFenceMarker = fenceMarker;
      }
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
    hasDnSection,
    hasCursorRules,
    customSections,
    rawContent: content,
  };
}

function hasDnSection(content: string): boolean {
  const structure = parseAgentsMd(content);
  if (!structure.hasDnSection) {
    return false;
  }

  const dnSection = structure.sections.find((s) =>
    s.name.includes("Using dn") || s.name.includes("Kickstart")
  );

  return dnSection !== undefined;
}

function genDnSection(): string {
  return `## Using dn

Use \`dn\` as the primary interface for this repo's GitHub workflows and plan
artifacts. Prefer it over ad-hoc scripts or direct API calls when reading
issues, updating GitHub state, preparing plans, or processing review feedback.

### GitHub access

Use \`dn issue\` for authenticated access to repository issues, including private
repositories that the signed-in user can access. Prefer it when an agent needs
to inspect or update issue state from the terminal.

\`\`\`bash
dn issue list --label bug
dn issue show 123
dn issue show 123 --json
dn issue comment 123 --body-file update.md
dn issue edit 123 --add-label needs-triage
dn issue create --title "Brief title" --body-file description.md
dn issue relationship list 123
\`\`\`

Guidelines:

- Use \`dn issue show <ref>\` before making issue edits so updates are based on
  current state.
- Prefer \`dn issue comment\` for append-only progress updates and refined
  understanding.
- Use \`dn issue edit\` only when the user explicitly wants the issue body or
  metadata changed.
- Use \`--json\` when structured output is useful for follow-up agent steps.
- Issue references may be \`123\`, \`#123\`, or a full GitHub issue URL.

When writing issue content, prefer concise structured Markdown:

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

### Workflow commands

Use the command that matches the stage of work:

\`\`\`bash
dn kickstart <issue-url-or-number>         # Full plan + implement workflow
dn prep <issue-url-or-number>              # Plan phase only
dn loop --plan-file plans/task.plan.md     # Implement from an existing plan
dn fixup <pull-request-url>                # Address PR review feedback
dn meld a.md b.md --plan-name merged       # Merge sources, then run prep
\`\`\`

Use \`dn kickstart\` when the user wants the whole issue implemented. Use
\`dn prep\` and \`dn loop\` separately when planning and implementation need to be
split across steps or reviewed between phases. Use \`dn fixup\` when the task is
to address existing PR comments rather than re-implement from scratch.

### Milestones, queues, and context

\`\`\`bash
dn init stack 42
dn kickstart --milestone 42
dn todo done 123
dn tidy
dn context check cli/main.ts
\`\`\`

- Use \`dn init stack\` and milestone-aware \`dn kickstart\` for ordered work from
  a GitHub milestone.
- Use \`dn todo done\` and \`dn tidy\` to manage the local prioritized task list
  in \`~/.dn/todo.md\`.
- Use \`dn context check\` to inspect inherited \`AGENTS.md\` context and prompt
  size when context assembly is relevant.

### Authentication

If GitHub operations fail due to missing auth, prefer existing cached auth. If
setup is needed, use:

\`\`\`bash
dn auth
\`\`\`
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

  if (hasDnSection(result)) {
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
