// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, isAbsolute, join, relative, resolve } from "@std/path";

const DEFAULT_MAX_BYTES = 32 * 1024;
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
const PROJECT_DOC_FILENAMES = ["AGENTS.override.md", "AGENTS.md"];

interface ParsedContextArgs {
  help: boolean;
  json: boolean;
  claudeTokens: boolean;
  claudeModel: string;
  maxBytes: number;
  targetPath: string | null;
}

interface InstructionSource {
  scope: "global" | "project";
  path: string;
  content: string;
  bytes: number;
}

interface ContextCheckResult {
  targetPath: string;
  targetDirectory: string;
  projectRoot: string | null;
  maxBytes: number;
  sources: Array<Omit<InstructionSource, "content">>;
  includedSources: string[];
  omittedSources: string[];
  fullContext: string;
  fullBytes: number;
  includedContext: string;
  includedBytes: number;
  truncated: boolean;
}

interface AnthropicCountResponse {
  input_tokens?: number;
  error?: {
    type?: string;
    message?: string;
  };
}

function formatByteCount(bytes: number): string {
  return new Intl.NumberFormat("en-US").format(bytes);
}

function formatKilobytes(bytes: number): string {
  const kilobytes = bytes / 1024;
  const formattedKilobytes = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: kilobytes < 1 ? 2 : 1,
  }).format(kilobytes);
  return `${formattedKilobytes} KB (${formatByteCount(bytes)} bytes)`;
}

function parseContextArgs(args: string[]): ParsedContextArgs {
  let help = false;
  let json = false;
  let claudeTokens = false;
  let claudeModel = DEFAULT_CLAUDE_MODEL;
  let maxBytes = DEFAULT_MAX_BYTES;
  let targetPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--claude-tokens") {
      claudeTokens = true;
    } else if (arg === "--claude-model") {
      const model = args[i + 1];
      if (!model) {
        throw new Error("Missing value for --claude-model");
      }
      claudeModel = model;
      i++;
    } else if (arg === "--max-bytes") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --max-bytes");
      }
      maxBytes = Number.parseInt(value, 10);
      if (!Number.isFinite(maxBytes) || maxBytes < 1) {
        throw new Error(`Invalid --max-bytes value: ${value}`);
      }
      i++;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!targetPath) {
      targetPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return {
    help,
    json,
    claudeTokens,
    claudeModel,
    maxBytes,
    targetPath,
  };
}

function showContextHelp(): void {
  console.log("dn context - Inspect AGENTS.md context inheritance\n");
  console.log("Usage:");
  console.log("  dn context check <file-or-directory> [options]\n");
  console.log("Options:");
  console.log(
    "  --max-bytes <n>       Byte limit to compare against (default: 32768)",
  );
  console.log(
    "  --claude-tokens       Count included context tokens via Anthropic API",
  );
  console.log(
    `  --claude-model <id>   Anthropic model for token counting (default: ${DEFAULT_CLAUDE_MODEL})`,
  );
  console.log("  --json                Output machine-readable JSON");
  console.log("  --help, -h            Show this help message\n");
  console.log("Examples:");
  console.log("  dn context check cli/main.ts");
  console.log("  dn context check cli/main.ts --max-bytes 65536");
  console.log("  dn context check cli/main.ts --claude-tokens");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function readFirstNonEmptyInstructionFile(
  dirPath: string,
  scope: "global" | "project",
): Promise<InstructionSource | null> {
  const encoder = new TextEncoder();

  for (const filename of PROJECT_DOC_FILENAMES) {
    const candidatePath = join(dirPath, filename);
    if (!(await fileExists(candidatePath))) {
      continue;
    }

    const stat = await Deno.stat(candidatePath);
    if (!stat.isFile) {
      continue;
    }

    const content = await Deno.readTextFile(candidatePath);
    if (content.trim().length === 0) {
      continue;
    }

    const realPath = await Deno.realPath(candidatePath);

    return {
      scope,
      path: realPath,
      content,
      bytes: encoder.encode(content).length,
    };
  }

  return null;
}

async function detectProjectRoot(startDir: string): Promise<string | null> {
  let currentDir = startDir;

  while (true) {
    if (
      await fileExists(join(currentDir, ".sl")) ||
      await fileExists(join(currentDir, ".git"))
    ) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function buildDirectoryChain(root: string, leaf: string): string[] {
  const relativeLeaf = relative(root, leaf);
  if (relativeLeaf.length === 0) {
    return [root];
  }

  const segments = relativeLeaf.split(/[\\/]+/).filter((segment) =>
    segment.length > 0
  );
  const chain = [root];
  let current = root;

  for (const segment of segments) {
    current = join(current, segment);
    chain.push(current);
  }

  return chain;
}

async function discoverInstructionSources(
  targetDirectory: string,
): Promise<{ projectRoot: string | null; sources: InstructionSource[] }> {
  const sources: InstructionSource[] = [];
  const codeHome = Deno.env.get("CODEX_HOME");
  const homeDir = Deno.env.get("HOME");
  const codexHome = codeHome ?? (homeDir ? join(homeDir, ".codex") : null);

  if (codexHome) {
    const globalSource = await readFirstNonEmptyInstructionFile(
      codexHome,
      "global",
    );
    if (globalSource) {
      sources.push(globalSource);
    }
  }

  const projectRoot = await detectProjectRoot(targetDirectory);
  if (!projectRoot) {
    const localSource = await readFirstNonEmptyInstructionFile(
      targetDirectory,
      "project",
    );
    if (localSource) {
      sources.push(localSource);
    }
    return { projectRoot: null, sources };
  }

  for (const dirPath of buildDirectoryChain(projectRoot, targetDirectory)) {
    const source = await readFirstNonEmptyInstructionFile(dirPath, "project");
    if (source) {
      sources.push(source);
    }
  }

  return { projectRoot, sources };
}

function joinInstructionContents(sources: InstructionSource[]): string {
  return sources.map((source) => source.content).join("\n\n");
}

function measureBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export async function checkAgentsContext(
  rawTargetPath: string,
  maxBytes: number,
): Promise<ContextCheckResult> {
  const unresolvedTargetPath = isAbsolute(rawTargetPath)
    ? rawTargetPath
    : resolve(Deno.cwd(), rawTargetPath);
  const targetPath = await Deno.realPath(unresolvedTargetPath).catch(
    (error) => {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Target does not exist: ${rawTargetPath}`);
      }
      throw error;
    },
  );

  const stat = await Deno.stat(targetPath).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Target does not exist: ${rawTargetPath}`);
    }
    throw error;
  });

  const targetDirectory = stat.isDirectory ? targetPath : dirname(targetPath);
  const { projectRoot, sources } = await discoverInstructionSources(
    targetDirectory,
  );

  const fullContext = joinInstructionContents(sources);
  const fullBytes = measureBytes(fullContext);

  const includedSources: InstructionSource[] = [];
  let includedContext = "";
  let includedBytes = 0;

  for (const source of sources) {
    const nextContext = includedSources.length === 0
      ? source.content
      : `${includedContext}\n\n${source.content}`;
    const nextBytes = measureBytes(nextContext);

    if (nextBytes > maxBytes) {
      break;
    }

    includedSources.push(source);
    includedContext = nextContext;
    includedBytes = nextBytes;
  }

  return {
    targetPath,
    targetDirectory,
    projectRoot,
    maxBytes,
    sources: sources.map(({ content: _content, ...source }) => source),
    includedSources: includedSources.map((source) => source.path),
    omittedSources: sources.slice(includedSources.length).map((source) =>
      source.path
    ),
    fullContext,
    fullBytes,
    includedContext,
    includedBytes,
    truncated: includedSources.length < sources.length,
  };
}

async function countAnthropicTokens(
  content: string,
  model: string,
): Promise<number> {
  if (content.length === 0) {
    return 0;
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when using --claude-tokens",
    );
  }

  const response = await fetch(
    "https://api.anthropic.com/v1/messages/count_tokens",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content,
          },
        ],
      }),
    },
  );

  const data = await response.json() as AnthropicCountResponse;
  if (!response.ok) {
    const message = data.error?.message ??
      `Anthropic API error (${response.status})`;
    throw new Error(message);
  }

  if (typeof data.input_tokens !== "number") {
    throw new Error("Anthropic API did not return input_tokens");
  }

  return data.input_tokens;
}

function formatContextReport(result: ContextCheckResult): string {
  const lines: string[] = [];

  lines.push("dn context check");
  lines.push("");
  lines.push(`Target: ${result.targetPath}`);
  lines.push(`Directory: ${result.targetDirectory}`);
  lines.push(`Project root: ${result.projectRoot ?? "(not detected)"}`);
  lines.push(`Max size: ${formatKilobytes(result.maxBytes)}`);
  lines.push(`Full context: ${formatKilobytes(result.fullBytes)}`);
  lines.push(`Included: ${formatKilobytes(result.includedBytes)}`);
  lines.push(`Truncated: ${result.truncated ? "yes" : "no"}`);
  lines.push("");
  lines.push("Sources:");

  if (result.sources.length === 0) {
    lines.push("  (none)");
    return lines.join("\n");
  }

  for (const source of result.sources) {
    const included = result.includedSources.includes(source.path)
      ? "included"
      : "omitted";
    lines.push(
      `  - [${source.scope}] ${source.path} (${
        formatKilobytes(source.bytes)
      }, ${included})`,
    );
  }

  return lines.join("\n");
}

export async function handleContext(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showContextHelp();
    return;
  }

  const subcommand = args[0];
  if (subcommand !== "check") {
    console.error(`Unknown context subcommand: ${subcommand}\n`);
    showContextHelp();
    Deno.exit(1);
  }

  try {
    const parsed = parseContextArgs(args.slice(1));

    if (parsed.help) {
      showContextHelp();
      return;
    }

    if (!parsed.targetPath) {
      throw new Error("Target file or directory is required");
    }

    const result = await checkAgentsContext(parsed.targetPath, parsed.maxBytes);
    const output: Record<string, unknown> = { ...result };

    if (parsed.claudeTokens) {
      output.claudeModel = parsed.claudeModel;
      output.claudeInputTokens = await countAnthropicTokens(
        result.includedContext,
        parsed.claudeModel,
      );
    }

    if (parsed.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(formatContextReport(result));
    if (parsed.claudeTokens) {
      console.log("");
      console.log(`Claude model: ${parsed.claudeModel}`);
      console.log(`Claude input tokens: ${String(output.claudeInputTokens)}`);
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await handleContext(Deno.args);
}
