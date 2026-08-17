// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  assembleCombinedPrompt,
  formatDelegatedCommandsPrompt,
} from "./prompt.ts";

async function withPromptFixture(options: {
  steeringPrompt?: string;
  extraFiles?: Record<string, string>;
  contextFileNames?: readonly string[];
  missingContextFiles?: readonly string[];
}): Promise<string> {
  const directory = await Deno.makeTempDir({ prefix: "dn-prompt-test-" });
  const systemPromptPath = `${directory}/system.md`;
  const outputPath = `${directory}/combined.md`;
  await Deno.writeTextFile(systemPromptPath, "System prompt");
  for (const [name, content] of Object.entries(options.extraFiles ?? {})) {
    await Deno.writeTextFile(`${directory}/${name}`, content);
  }
  const contextFiles = [
    ...(options.contextFileNames ?? []).map((name) => `${directory}/${name}`),
    ...(options.missingContextFiles ?? []),
  ];
  try {
    await assembleCombinedPrompt(
      outputPath,
      systemPromptPath,
      directory,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options.steeringPrompt,
      contextFiles.length > 0 ? contextFiles : undefined,
    );
    return await Deno.readTextFile(outputPath);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("combined prompts append a final steering section", async () => {
  const steeringPrompt = "Focus on parser validation: preserve punctuation.";
  const output = await withPromptFixture({ steeringPrompt });

  assertStringIncludes(output, `# Steering Prompt\n${steeringPrompt}`);
  assertEquals(output.endsWith(steeringPrompt), true);
});

Deno.test("combined prompts omit steering section when not configured", async () => {
  const output = await withPromptFixture({});

  assertEquals(output.includes("# Steering Prompt"), false);
});

Deno.test("combined prompts append included files before steering", async () => {
  const output = await withPromptFixture({
    steeringPrompt: "Keep the diff small.",
    extraFiles: { "notes.md": "Remember the parser." },
    contextFileNames: ["notes.md"],
  });

  assertStringIncludes(
    output,
    "# Included File (notes.md)\nRemember the parser.",
  );
  assertStringIncludes(output, "# Steering Prompt\nKeep the diff small.");
  assertEquals(
    output.indexOf("# Included File") < output.indexOf("# Steering Prompt"),
    true,
  );
});

Deno.test("combined prompts include delegated commands from dn.json", async () => {
  const output = await withPromptFixture({
    extraFiles: {
      "dn.json": JSON.stringify({
        schema_version: "2.0",
        ensure: {
          lint: {
            argv: ["make", "lint"],
            intent: "Fix lint until make lint exits 0.",
          },
        },
      }),
    },
  });
  assertStringIncludes(output, "# Delegated commands");
  assertStringIncludes(output, "`dn ensure lint`");
  assertStringIncludes(output, "`make lint`");
});

Deno.test("combined prompts omit delegated commands when none are configured", async () => {
  const output = await withPromptFixture({});
  assertEquals(output.includes("# Delegated commands"), false);
});

Deno.test("formatDelegatedCommandsPrompt lists recipes", () => {
  const section = formatDelegatedCommandsPrompt({
    lint: { argv: ["make", "lint"], intent: "Fix lint." },
  });
  assertStringIncludes(section, "# Delegated commands");
  assertStringIncludes(section, "`dn ensure lint`");
  assertEquals(formatDelegatedCommandsPrompt(undefined), "");
  assertEquals(formatDelegatedCommandsPrompt({}), "");
});

Deno.test("combined prompts fail when a context file is missing", async () => {
  await assertRejects(
    () =>
      withPromptFixture({
        missingContextFiles: ["/no/such/dn-context-file.md"],
      }),
    Error,
    "--context-file not found",
  );
});
