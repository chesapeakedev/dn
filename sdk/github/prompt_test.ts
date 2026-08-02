// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { assembleCombinedPrompt } from "./prompt.ts";

async function withPromptFixture(
  steeringPrompt: string | undefined,
): Promise<string> {
  const directory = await Deno.makeTempDir({ prefix: "dn-prompt-test-" });
  const systemPromptPath = `${directory}/system.md`;
  const outputPath = `${directory}/combined.md`;
  await Deno.writeTextFile(systemPromptPath, "System prompt");
  await assembleCombinedPrompt(
    outputPath,
    systemPromptPath,
    directory,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    steeringPrompt,
  );
  const output = await Deno.readTextFile(outputPath);
  await Deno.remove(directory, { recursive: true });
  return output;
}

Deno.test("combined prompts append a final steering section", async () => {
  const steeringPrompt = "Focus on parser validation: preserve punctuation.";
  const output = await withPromptFixture(steeringPrompt);

  assertStringIncludes(output, `# Steering Prompt\n${steeringPrompt}`);
  assertEquals(output.endsWith(steeringPrompt), true);
});

Deno.test("combined prompts omit steering section when not configured", async () => {
  const output = await withPromptFixture(undefined);

  assertEquals(output.includes("# Steering Prompt"), false);
});
