// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * **`dn ensure`** — run a named `dn.json` recipe and, on failure, loop a
 * fixer agent until the command exits 0.
 */

import { dirname, join, resolve } from "@std/path";
import { resolveDnConfig } from "../sdk/config/resolve.ts";
import type { DnEnsureConfig, DnEnsureRecipe } from "../sdk/config/types.ts";
import { resolveLocalAgentHarness } from "../sdk/config/localAgent.ts";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import { parseAgentHarnessFlagsFromArgs } from "../sdk/github/agentHarness.ts";
import { runAgentPhaseInSandbox } from "../sdk/sandbox/agentPhase.ts";
import {
  extractSandboxFlag,
  resolveSandboxFlagValue,
} from "../sdk/sandbox/cli.ts";
import {
  resolveSandboxConfig,
  type SandboxFlagValue,
} from "../sdk/sandbox/resolve.ts";
import { runWithSandboxLifecycle } from "../sdk/sandbox/lifecycle.ts";
import type { ExecResult } from "../sdk/sandbox/types.ts";

/** Environment flag that makes nested `dn ensure` argv-only (no fixer agent). */
export const DN_ENSURE_ACTIVE_ENV = "DN_ENSURE_ACTIVE";

/** Default gate attempts including the first exec. */
export const DEFAULT_ENSURE_ITERATIONS = 5;

/** Captured argv execution used for display and fixer prompts. */
export interface EnsureCapture {
  code: number;
  stdout: string;
  stderr: string;
}

/** Parsed `dn ensure` arguments. */
export interface EnsureCliOptions {
  help: boolean;
  noFix: boolean;
  name: string | null;
  workspaceRoot: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** True when this process is already inside a `dn ensure` fixer agent. */
export function isEnsureActive(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): boolean {
  return isTruthyEnv(env[DN_ENSURE_ACTIVE_ENV]);
}

function showHelp(): void {
  console.log("dn ensure - Make a named dn.json recipe pass\n");
  console.log("Usage:");
  console.log("  dn ensure");
  console.log("  dn ensure <name>");
  console.log("  dn ensure <name> --no-fix\n");
  console.log("Recipes live in dn.json under `ensure`. Each recipe has frozen");
  console.log("argv (no shell) and an intent string. On failure, dn captures");
  console.log("output and runs a fixer agent until the command exits 0 or the");
  console.log("iteration bound is reached.\n");
  console.log("Options:");
  console.log(
    "  --no-fix                 Fail after one exec (no fixer agent)",
  );
  console.log("  --workspace-root <path>  Directory to search for dn.json");
  console.log("  --help, -h               Show this help\n");
  console.log("Examples:");
  console.log("  dn ensure");
  console.log("  dn ensure lint");
  console.log("  dn ensure tests --no-fix");
}

/** Parses ensure-specific flags and the optional recipe name. */
export function parseEnsureArgs(args: string[]): EnsureCliOptions {
  let help = false;
  let noFix = false;
  let workspaceRoot = Deno.cwd();
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--no-fix") {
      noFix = true;
    } else if (arg === "--workspace-root") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--workspace-root requires a path");
      }
      workspaceRoot = resolve(value);
      i++;
    } else if (
      arg === "--cursor" || arg === "-c" || arg === "--claude" ||
      arg === "--codex" || arg === "--copilot" || arg === "--opencode"
    ) {
      continue;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown ensure option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 1) {
    throw new Error(
      `dn ensure does not accept extra arguments after the recipe name (got ${
        positionals.slice(1).map((value) => JSON.stringify(value)).join(", ")
      })`,
    );
  }

  return {
    help,
    noFix,
    name: positionals[0] ?? null,
    workspaceRoot,
  };
}

/**
 * Walks from `start` toward filesystem root and returns the first directory
 * that contains `dn.json`.
 */
export function findDnJsonDir(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    try {
      Deno.statSync(join(dir, "dn.json"));
      return dir;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Recipe names from `dn.json` walking up from `start`, or an empty list. */
export function loadEnsureRecipeNames(start: string): string[] {
  const dir = findDnJsonDir(start);
  if (dir === null) return [];
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(join(dir, "dn.json")));
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    ) {
      return [];
    }
    const ensure = (parsed as Record<string, unknown>).ensure;
    if (
      typeof ensure !== "object" || ensure === null || Array.isArray(ensure)
    ) {
      return [];
    }
    return Object.keys(ensure as Record<string, unknown>).sort();
  } catch {
    return [];
  }
}

function quoteArgv(argv: string[]): string {
  return argv.map((arg) => {
    if (/^[\w./:=+-]+$/.test(arg)) return arg;
    return JSON.stringify(arg);
  }).join(" ");
}

function recipeNames(recipes: DnEnsureConfig): string[] {
  return Object.keys(recipes).sort();
}

function formatRecipeList(recipes: DnEnsureConfig): string {
  const names = recipeNames(recipes);
  if (names.length === 0) {
    return "No ensure recipes configured in dn.json.\n";
  }
  const lines: string[] = [];
  for (const name of names) {
    const recipe = recipes[name];
    if (recipe === undefined) continue;
    lines.push(name);
    lines.push(`  argv: ${quoteArgv(recipe.argv)}`);
    lines.push(`  intent: ${recipe.intent}`);
    if (recipe.iterations !== undefined) {
      lines.push(`  iterations: ${recipe.iterations}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function unknownRecipeError(
  name: string,
  recipes: DnEnsureConfig,
): Error {
  const names = recipeNames(recipes);
  const known = names.length === 0
    ? "none"
    : names.map((value) => JSON.stringify(value)).join(", ");
  return new Error(
    `Unknown ensure recipe ${JSON.stringify(name)}. Known recipes: ${known}`,
  );
}

function missingEnsureError(repoRoot: string): Error {
  return new Error(
    `No ensure recipes in dn.json. Add an "ensure" object with named recipes at ${
      join(repoRoot, "dn.json")
    }`,
  );
}

async function teeStream(
  stream: ReadableStream<Uint8Array> | null,
  dest: typeof Deno.stdout,
): Promise<string> {
  if (stream === null) return "";
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    await dest.write(chunk);
  }
  text += decoder.decode();
  return text;
}

/** Executes recipe argv with no shell, teeing stdout/stderr to the terminal. */
export async function execRecipeArgv(
  argv: string[],
  cwd: string,
): Promise<EnsureCapture> {
  const [command, ...args] = argv;
  if (command === undefined) {
    throw new Error("ensure recipe argv must be a non-empty array");
  }
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(command, {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
      stdin: "inherit",
    }).spawn();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${command} not found on PATH`);
    }
    throw error;
  }
  const [stdout, stderr, status] = await Promise.all([
    teeStream(child.stdout, Deno.stdout),
    teeStream(child.stderr, Deno.stderr),
    child.status,
  ]);
  const code = status.success
    ? 0
    : (typeof status.code === "number" ? status.code : 1);
  return { code, stdout, stderr };
}

/** Builds the fixer-agent prompt for a failed recipe exec. */
export function formatFixerPrompt(
  name: string,
  recipe: DnEnsureRecipe,
  capture: EnsureCapture,
): string {
  const command = quoteArgv(recipe.argv);
  return `# Ensure fixer: ${name}

You are fixing a failed project command. Do **not** invoke \`dn ensure\`.
Run the raw command to verify: \`${command}\`

## Intent

${recipe.intent}

## Failed command

\`${command}\`

Exit code: ${capture.code}

## stdout

\`\`\`
${capture.stdout}
\`\`\`

## stderr

\`\`\`
${capture.stderr}
\`\`\`

Make the smallest change that satisfies the intent, then re-run \`${command}\`
until it exits 0.
`;
}

export interface RunEnsureRecipeOptions {
  name: string;
  recipe: DnEnsureRecipe;
  workspaceRoot: string;
  noFix: boolean;
  nested: boolean;
  agent: AgentHarness;
  exec?: (
    argv: string[],
    cwd: string,
  ) => Promise<EnsureCapture>;
  runFixer?: (
    name: string,
    recipe: DnEnsureRecipe,
    capture: EnsureCapture,
    workspaceRoot: string,
    agent: AgentHarness,
  ) => Promise<ExecResult>;
}

async function defaultRunFixer(
  name: string,
  recipe: DnEnsureRecipe,
  capture: EnsureCapture,
  workspaceRoot: string,
  agent: AgentHarness,
): Promise<ExecResult> {
  const promptPath = await Deno.makeTempFile({
    dir: workspaceRoot,
    prefix: ".dn-ensure-",
    suffix: ".md",
  });
  const previous = Deno.env.get(DN_ENSURE_ACTIVE_ENV);
  try {
    await Deno.writeTextFile(
      promptPath,
      formatFixerPrompt(name, recipe, capture),
    );
    Deno.env.set(DN_ENSURE_ACTIVE_ENV, "1");
    return await runAgentPhaseInSandbox(
      "implement",
      promptPath,
      workspaceRoot,
      false,
      agent,
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete(DN_ENSURE_ACTIVE_ENV);
    } else {
      Deno.env.set(DN_ENSURE_ACTIVE_ENV, previous);
    }
    await Deno.remove(promptPath).catch(() => undefined);
  }
}

/**
 * Gate-first loop: exec argv, spawn a fixer only on failure, retry until
 * success or the iteration bound.
 */
export async function runEnsureRecipe(
  options: RunEnsureRecipeOptions,
): Promise<EnsureCapture> {
  const exec = options.exec ?? execRecipeArgv;
  const runFixer = options.runFixer ?? defaultRunFixer;
  const bound = options.recipe.iterations ?? DEFAULT_ENSURE_ITERATIONS;
  const skipFixer = options.noFix || options.nested;
  let last: EnsureCapture | undefined;

  for (let attempt = 1; attempt <= bound; attempt++) {
    console.log(
      `[dn ensure] ${options.name}: ${quoteArgv(options.recipe.argv)}` +
        (bound > 1 && !skipFixer ? ` (attempt ${attempt}/${bound})` : ""),
    );
    last = await exec(options.recipe.argv, options.workspaceRoot);
    if (last.code === 0) {
      return last;
    }
    if (skipFixer || attempt === bound) {
      break;
    }
    console.log(
      `[dn ensure] ${options.name}: exit ${last.code}; running fixer agent`,
    );
    const fixer = await runFixer(
      options.name,
      options.recipe,
      last,
      options.workspaceRoot,
      options.agent,
    );
    if (fixer.code !== 0) {
      console.log(
        `[dn ensure] ${options.name}: fixer agent exited ${fixer.code}; retrying gate`,
      );
    }
  }

  if (last === undefined) {
    throw new Error(`ensure ${options.name}: no attempts ran`);
  }
  return last;
}

function resolveEnsureRepoRoot(start: string): string {
  const found = findDnJsonDir(start);
  return found ?? resolve(start);
}

/** Handles the `dn ensure` command. */
export async function handleEnsure(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): Promise<void> {
  const { sandbox: localSandbox, rest: afterSandbox } = extractSandboxFlag(
    args,
  );
  const parsed = parseEnsureArgs(afterSandbox);
  if (parsed.help || parsed.name === "help") {
    showHelp();
    return;
  }

  const repoRoot = resolveEnsureRepoRoot(parsed.workspaceRoot);
  const config = await resolveDnConfig({ repoRoot });
  const recipes = config.ensure;

  const name = parsed.name;
  if (name === null) {
    if (recipes === undefined) {
      throw missingEnsureError(repoRoot);
    }
    console.log(formatRecipeList(recipes));
    return;
  }

  if (recipes === undefined) {
    throw missingEnsureError(repoRoot);
  }
  const recipe = recipes[name];
  if (recipe === undefined) {
    throw unknownRecipeError(name, recipes);
  }

  const agentFlags = parseAgentHarnessFlagsFromArgs(afterSandbox);
  const agent = await resolveLocalAgentHarness({
    repoRoot,
    agent: globalAgent,
    ...agentFlags,
  });
  const sandboxFlag = resolveSandboxFlagValue(globalSandbox, localSandbox);
  const resolvedSandbox = await resolveSandboxConfig(repoRoot, sandboxFlag);
  const nested = isEnsureActive();
  const skipLifecycle = parsed.noFix || nested;

  const run = async (): Promise<EnsureCapture> =>
    await runEnsureRecipe({
      name,
      recipe,
      workspaceRoot: repoRoot,
      noFix: parsed.noFix,
      nested,
      agent,
    });

  const result = skipLifecycle ? await run() : await runWithSandboxLifecycle(
    { repoRoot, ...resolvedSandbox },
    run,
  );

  if (result.code !== 0) {
    const reason = nested
      ? "nested dn ensure is passthrough (DN_ENSURE_ACTIVE)"
      : parsed.noFix
      ? "--no-fix"
      : "fixer loop exhausted";
    console.error(
      `[dn ensure] ${name} failed with exit ${result.code} (${reason})`,
    );
    Deno.exit(result.code);
  }
}
