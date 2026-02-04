// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Assembles a combined prompt file by concatenating:
 * 1. System prompt (from phase-specific prompt file)
 * 2. AGENTS.md (project guidelines, if it exists)
 * 3. deno.json (project configuration, if it exists)
 * 4. Previous plan (if provided, for continuing existing plans)
 * 5. Plan output (if provided, for implement phase)
 * 6. Issue context (the actual issue to implement)
 *
 * Each section is separated by markdown horizontal rules (`---`).
 *
 * @param outputPath - Path where the combined prompt file should be written
 * @param systemPromptPath - Path to the system prompt file (plan or implement)
 * @param projectRoot - Root directory of the project
 * @param issueContextPath - Path to the issue context markdown file
 * @param planOutputPath - Optional path to plan phase output to include
 * @param existingPlanContent - Optional existing plan content to include (for continuation)
 * @throws Error if the system prompt file cannot be found
 */
export async function assembleCombinedPrompt(
  outputPath: string,
  systemPromptPath: string,
  projectRoot: string,
  issueContextPath: string | undefined,
  planOutputPath?: string,
  existingPlanContent?: string | null,
): Promise<void> {
  // Read system prompt
  let systemPrompt: string;
  try {
    systemPrompt = await Deno.readTextFile(systemPromptPath);
  } catch {
    throw new Error(`System prompt not found at ${systemPromptPath}`);
  }

  // Start with system prompt
  await Deno.writeTextFile(outputPath, systemPrompt);

  // Append AGENTS.md if it exists
  const agentsMdPath = `${projectRoot}/AGENTS.md`;
  try {
    await Deno.stat(agentsMdPath);
    const agentsMd = await Deno.readTextFile(agentsMdPath);
    await Deno.writeTextFile(
      outputPath,
      `\n\n---\n\n# Project Guidelines (AGENTS.md)\n${agentsMd}`,
      { append: true },
    );
  } catch {
    // AGENTS.md doesn't exist, skip it
  }

  // Append deno.json if it exists
  const denoJsonPath = `${projectRoot}/deno.json`;
  try {
    await Deno.stat(denoJsonPath);
    const denoJson = await Deno.readTextFile(denoJsonPath);
    await Deno.writeTextFile(
      outputPath,
      `\n\n---\n\n# Project Configuration (deno.json)\n${denoJson}`,
      { append: true },
    );
  } catch {
    // deno.json doesn't exist, skip it
  }

  // Append existing plan content if provided (for continuation)
  if (existingPlanContent) {
    await Deno.writeTextFile(
      outputPath,
      `\n\n---\n\n# Previous Plan\n\n${existingPlanContent}`,
      { append: true },
    );
  }

  // Append plan output if provided (for implement phase)
  if (planOutputPath) {
    try {
      await Deno.stat(planOutputPath);
      const planOutput = await Deno.readTextFile(planOutputPath);
      await Deno.writeTextFile(
        outputPath,
        `\n\n---\n\n# Plan Phase Output\n${planOutput}`,
        { append: true },
      );
    } catch {
      // Plan output doesn't exist, skip it
    }
  }

  // Append issue context (if provided)
  if (issueContextPath) {
    try {
      const issueContext = await Deno.readTextFile(issueContextPath);
      await Deno.writeTextFile(
        outputPath,
        `\n\n---\n\n# Issue Context\n${issueContext}`,
        { append: true },
      );
    } catch {
      // Issue context file doesn't exist, skip it
    }
  }
}
