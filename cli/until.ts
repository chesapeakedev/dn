// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Goal-driven generator/verifier workflows (`dn until`). */

import { dirname, resolve } from "@std/path";
import type { AgentHarness } from "../sdk/github/agentHarness.ts";
import {
  parseAgentHarnessFlagsFromArgs,
  resolveAgentHarnessFromFlagsAndEnv,
} from "../sdk/github/agentHarness.ts";
import { runAgentPhaseInSandbox } from "../sdk/sandbox/agentPhase.ts";
import {
  extractSandboxFlag,
  resolveSandboxFlagValue,
} from "../sdk/sandbox/cli.ts";
import {
  parseDnSandboxConfig,
  withSandboxProvider,
} from "../sdk/sandbox/config.ts";
import { getCurrentSandboxContext } from "../sdk/sandbox/context.ts";
import { runWithSandboxLifecycle } from "../sdk/sandbox/lifecycle.ts";
import type { SandboxFlagValue } from "../sdk/sandbox/resolve.ts";
import {
  resolveSandboxConfig,
  resolveSandboxProvider,
} from "../sdk/sandbox/resolve.ts";
import type { DnSandboxConfig, ExecResult } from "../sdk/sandbox/types.ts";

/** Default workspace-relative path for prompt-verifier verdict files. */
export const DEFAULT_VERDICT_PATH = ".dn/until-verdict.json";

/** A generator action. Exactly one of prompt and script is required. */
export interface UntilAction {
  prompt?: string;
  script?: string;
}

/** Optional text completion promise for prompt verifiers. */
export interface DoneWhen {
  stdout_contains: string;
}

/** Verifier action plus optional prompt done-check configuration. */
export interface VerifierConfig extends UntilAction {
  /** Workspace-relative path for a JSON verdict file written by the verifier. */
  verdict_path?: string;
  /** Ralph-style escape hatch: treat stdout containing this string as done. */
  done_when?: DoneWhen;
}

/** A bounded generator/verifier workflow. */
export interface GambitConfig {
  name?: string;
  generator: UntilAction;
  verifier: VerifierConfig;
  generator_interval_ms: number;
  verifier_interval_ms: number;
  max_iterations: number;
  timeout_ms: number;
  one_shot: boolean;
  metadata: Record<string, string>;
  secrets: string[];
}

/** Parsed contents of a gambit JSON file. */
export interface UntilConfig {
  sandbox?: DnSandboxConfig;
  gambits: GambitConfig[];
}

/** Options that affect prompt-verifier done resolution. */
export interface RunGambitOptions {
  once: boolean;
  strictVerdict?: boolean;
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TEMPLATE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(
  value: unknown,
  field: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function positiveInteger(
  value: unknown,
  field: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value as number;
}

function parseAction(value: unknown, field: string): UntilAction {
  const action = record(value, field);
  const prompt = action.prompt;
  const script = action.script;
  if ((typeof prompt === "string") === (typeof script === "string")) {
    throw new Error(`${field} requires exactly one string: prompt or script`);
  }
  const text = typeof prompt === "string" ? prompt : script as string;
  if (text.trim().length === 0) {
    throw new Error(`${field}.prompt or ${field}.script must not be empty`);
  }
  return typeof prompt === "string" ? { prompt } : { script: script as string };
}

function parseDoneWhen(
  value: unknown,
  field: string,
): DoneWhen | undefined {
  if (value === undefined) return undefined;
  const doneWhen = record(value, field);
  const stdoutContains = doneWhen.stdout_contains;
  if (typeof stdoutContains !== "string" || stdoutContains.length === 0) {
    throw new Error(`${field}.stdout_contains must be a non-empty string`);
  }
  return { stdout_contains: stdoutContains };
}

function parseVerifier(value: unknown, field: string): VerifierConfig {
  const action = parseAction(value, field);
  const raw = record(value, field);
  const verdictPath = raw.verdict_path;
  if (
    verdictPath !== undefined &&
    (typeof verdictPath !== "string" || verdictPath.trim().length === 0)
  ) {
    throw new Error(`${field}.verdict_path must be a non-empty string`);
  }
  if (
    action.script && (verdictPath !== undefined || raw.done_when !== undefined)
  ) {
    throw new Error(
      `${field}: verdict_path and done_when apply only to prompt verifiers`,
    );
  }
  const doneWhen = parseDoneWhen(raw.done_when, `${field}.done_when`);
  return {
    ...action,
    ...(typeof verdictPath === "string"
      ? { verdict_path: verdictPath.trim() }
      : {}),
    ...(doneWhen ? { done_when: doneWhen } : {}),
  };
}

function parseStringRecord(
  value: unknown,
  field: string,
): Record<string, string> {
  if (value === undefined) return {};
  const values = record(value, field);
  for (const [key, item] of Object.entries(values)) {
    if (!TEMPLATE_KEY.test(key)) {
      throw new Error(
        `${field}.${key} keys must match ${TEMPLATE_KEY.source}`,
      );
    }
    if (typeof item !== "string") {
      throw new Error(`${field}.${key} must be a string`);
    }
  }
  return values as Record<string, string>;
}

function parseSecrets(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !ENV_NAME.test(item))
  ) {
    throw new Error("secrets must be an array of environment variable names");
  }
  return [...new Set(value)];
}

function parseGambit(value: unknown, index: number): GambitConfig {
  const gambit = record(value, `gambits[${index}]`);
  if (gambit.name !== undefined && typeof gambit.name !== "string") {
    throw new Error(`gambits[${index}].name must be a string`);
  }
  if (gambit.one_shot !== undefined && typeof gambit.one_shot !== "boolean") {
    throw new Error(`gambits[${index}].one_shot must be a boolean`);
  }
  return {
    ...(typeof gambit.name === "string" ? { name: gambit.name } : {}),
    generator: parseAction(gambit.generator, `gambits[${index}].generator`),
    verifier: parseVerifier(gambit.verifier, `gambits[${index}].verifier`),
    generator_interval_ms: nonNegativeInteger(
      gambit.generator_interval_ms,
      `gambits[${index}].generator_interval_ms`,
      0,
    ),
    verifier_interval_ms: nonNegativeInteger(
      gambit.verifier_interval_ms,
      `gambits[${index}].verifier_interval_ms`,
      0,
    ),
    max_iterations: positiveInteger(
      gambit.max_iterations,
      `gambits[${index}].max_iterations`,
      DEFAULT_MAX_ITERATIONS,
    ),
    timeout_ms: positiveInteger(
      gambit.timeout_ms,
      `gambits[${index}].timeout_ms`,
      DEFAULT_TIMEOUT_MS,
    ),
    one_shot: gambit.one_shot === true,
    metadata: parseStringRecord(gambit.metadata, `gambits[${index}].metadata`),
    secrets: parseSecrets(gambit.secrets),
  };
}

/** Parses a single gambit or a { gambits: [] } configuration document. */
export function parseUntilConfig(value: unknown): UntilConfig {
  const root = record(value, "gambit config");
  const gambitsRaw = root.gambits === undefined ? [root] : root.gambits;
  if (!Array.isArray(gambitsRaw) || gambitsRaw.length === 0) {
    throw new Error("gambits must be a non-empty array");
  }
  return {
    ...(root.sandbox === undefined
      ? {}
      : { sandbox: parseDnSandboxConfig(root.sandbox) }),
    gambits: gambitsRaw.map(parseGambit),
  };
}

/**
 * Substitutes `{{key}}` placeholders from metadata and prepends a Context block
 * so metadata is never silent for prompt actions.
 */
export function applyMetadataToPrompt(
  prompt: string,
  metadata: Record<string, string>,
): string {
  let rendered = prompt;
  for (const [key, value] of Object.entries(metadata)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  if (Object.keys(metadata).length === 0) return rendered;
  const contextLines = Object.entries(metadata)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  return `## Context\n\n${contextLines}\n\n${rendered}`;
}

function appendVerdictInstructions(
  prompt: string,
  verdictPath: string,
): string {
  return `${prompt}

## Done check

When the goal is met, write exactly this JSON to \`${verdictPath}\` (create
parent directories if needed):

\`\`\`json
{ "done": true, "reason": "short note" }
\`\`\`

If the goal is not met yet, write \`{ "done": false, "reason": "..." }\` to the
same path, or omit the file. Do not rely on stdout alone for the done signal.
`;
}

/**
 * Finds the last fenced JSON block or last JSON object in text.
 * Returns null when nothing parseable is found.
 */
export function extractVerdictJson(text: string): { done?: unknown } | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fenced.length - 1; i >= 0; i--) {
    const body = fenced[i][1]?.trim() ?? "";
    try {
      const parsed = JSON.parse(body) as { done?: unknown };
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // try earlier fence / fallback
    }
  }
  const start = text.lastIndexOf("{");
  if (start === -1) return null;
  for (let end = text.length; end > start; end--) {
    const slice = text.slice(start, end).trim();
    try {
      const parsed = JSON.parse(slice) as { done?: unknown };
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // shrink until parse succeeds or give up
    }
  }
  return null;
}

async function readVerdictFile(
  workspaceRoot: string,
  verdictPath: string,
): Promise<{ done?: unknown } | null> {
  const absolute = resolve(workspaceRoot, verdictPath);
  try {
    const text = await Deno.readTextFile(absolute);
    return JSON.parse(text) as { done?: unknown };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Resolves whether a prompt verifier reported done.
 * Order: verdict file → extracted stdout JSON → optional stdout_contains.
 */
export async function resolvePromptDone(
  workspaceRoot: string,
  verifier: VerifierConfig,
  result: ExecResult,
  strictVerdict: boolean,
): Promise<boolean> {
  if (result.code !== 0) return false;

  const verdictPath = verifier.verdict_path ?? DEFAULT_VERDICT_PATH;
  const fromFile = await readVerdictFile(workspaceRoot, verdictPath);
  if (fromFile !== null) {
    return fromFile.done === true;
  }

  const fromStdout = extractVerdictJson(result.stdout);
  if (fromStdout !== null) {
    return fromStdout.done === true;
  }

  if (verifier.done_when?.stdout_contains) {
    return result.stdout.includes(verifier.done_when.stdout_contains);
  }

  if (strictVerdict) {
    throw new Error(
      `prompt verifier produced no verdict file at ${verdictPath} and no parseable JSON in stdout`,
    );
  }
  console.warn(
    `until: no verdict at ${verdictPath} and no JSON in stdout; treating as not done`,
  );
  return false;
}

function withGambitSecrets(
  config: DnSandboxConfig,
  gambits: GambitConfig[],
): DnSandboxConfig {
  const secrets = [...new Set(gambits.flatMap((gambit) => gambit.secrets))];
  if (secrets.length === 0) return config;
  return {
    ...config,
    docker: {
      ...config.docker,
      env_pass_through: [
        ...new Set([...config.docker.env_pass_through, ...secrets]),
      ],
    },
  };
}

async function sleep(milliseconds: number): Promise<void> {
  if (milliseconds > 0) {
    await new Promise((done) => setTimeout(done, milliseconds));
  }
}

async function runScript(
  script: string,
  workspaceRoot: string,
): Promise<ExecResult> {
  const sandbox = getCurrentSandboxContext();
  if (sandbox) {
    return await sandbox.runner.exec(sandbox.handle, ["sh", "-c", script], {
      cwd: sandbox.handle.workspace,
    });
  }
  const output = await new Deno.Command("sh", {
    args: ["-c", script],
    cwd: workspaceRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function ensureVerdictDir(
  workspaceRoot: string,
  verdictPath: string,
): Promise<void> {
  const absolute = resolve(workspaceRoot, verdictPath);
  await Deno.mkdir(dirname(absolute), { recursive: true });
}

async function runAction(
  action: UntilAction,
  workspaceRoot: string,
  agent: AgentHarness,
  metadata: Record<string, string>,
  verifierExtras?: Pick<VerifierConfig, "verdict_path">,
): Promise<ExecResult> {
  if (action.script) return await runScript(action.script, workspaceRoot);
  let prompt = applyMetadataToPrompt(action.prompt!, metadata);
  if (verifierExtras) {
    const verdictPath = verifierExtras.verdict_path ?? DEFAULT_VERDICT_PATH;
    await ensureVerdictDir(workspaceRoot, verdictPath);
    prompt = appendVerdictInstructions(prompt, verdictPath);
  }
  const promptPath = await Deno.makeTempFile({
    dir: workspaceRoot,
    prefix: ".dn-until-",
    suffix: ".md",
  });
  try {
    await Deno.writeTextFile(promptPath, prompt);
    return await runAgentPhaseInSandbox(
      "implement",
      promptPath,
      workspaceRoot,
      false,
      agent,
    );
  } finally {
    await Deno.remove(promptPath).catch(() => undefined);
  }
}

async function verifierSucceeded(
  workspaceRoot: string,
  verifier: VerifierConfig,
  result: ExecResult,
  strictVerdict: boolean,
): Promise<boolean> {
  if (verifier.script) return result.code === 0;
  return await resolvePromptDone(
    workspaceRoot,
    verifier,
    result,
    strictVerdict,
  );
}

/** Runs one gambit. Script verifiers succeed on exit code 0; prompt verifiers use layered done-checks. */
export async function runGambit(
  gambit: GambitConfig,
  workspaceRoot: string,
  agent: AgentHarness,
  options: RunGambitOptions,
): Promise<void> {
  const startedAt = Date.now();
  const limit = options.once || gambit.one_shot ? 1 : gambit.max_iterations;
  const strictVerdict = options.strictVerdict === true;
  const label = gambit.name ?? "gambit";
  for (let iteration = 1; iteration <= limit; iteration++) {
    if (Date.now() - startedAt > gambit.timeout_ms) {
      throw new Error(`Gambit ${label} timed out`);
    }
    console.log(
      `until ${label}: generator iteration ${iteration}/${limit}`,
    );
    const generator = await runAction(
      gambit.generator,
      workspaceRoot,
      agent,
      gambit.metadata,
    );
    if (generator.code !== 0) {
      throw new Error(
        `Generator failed with exit code ${generator.code}: ${
          generator.stderr || generator.stdout
        }`,
      );
    }
    await sleep(gambit.verifier_interval_ms);
    const verifier = await runAction(
      gambit.verifier,
      workspaceRoot,
      agent,
      gambit.metadata,
      gambit.verifier.prompt
        ? { verdict_path: gambit.verifier.verdict_path }
        : undefined,
    );
    if (
      await verifierSucceeded(
        workspaceRoot,
        gambit.verifier,
        verifier,
        strictVerdict,
      )
    ) {
      console.log(`until ${label}: verifier reported done`);
      return;
    }
    if (!gambit.verifier.script) {
      console.log(
        `until ${label}: verifier not done yet` +
          (verifier.stderr ? `; stderr: ${verifier.stderr.slice(0, 500)}` : ""),
      );
    }
    if (iteration < limit) await sleep(gambit.generator_interval_ms);
  }
  throw new Error(
    `Gambit ${label} did not complete within ${limit} iteration(s)`,
  );
}

function showHelp(): void {
  console.log(
    `dn until - Run bounded generator/verifier gambits

Usage:
  dn until validate <gambit.json>
  dn until run <gambit.json> [--once] [--strict-verdict] [--workspace-root <path>]

A gambit has generator and verifier actions. Each action has exactly one of
prompt or script. Script verifiers report done with exit code 0. Prompt
verifiers write JSON to ${DEFAULT_VERDICT_PATH} (or verifier.verdict_path), or
emit JSON in stdout, or match verifier.done_when.stdout_contains.
`,
  );
}

/** Handles the `dn until` command. */
export async function handleUntil(
  args: string[],
  globalAgent: AgentHarness | null = null,
  globalSandbox: SandboxFlagValue | null = null,
): Promise<void> {
  const { sandbox: localSandbox, rest } = extractSandboxFlag(args);
  const [command, configPath, ...options] = rest;
  if (command === "help" || command === "--help" || command === "-h") {
    return showHelp();
  }
  if ((command !== "validate" && command !== "run") || !configPath) {
    throw new Error("Usage: dn until <validate|run> <gambit.json>");
  }
  let once = false;
  let strictVerdict = false;
  let workspaceRoot = Deno.cwd();
  const agentFlags = parseAgentHarnessFlagsFromArgs(options);
  for (let index = 0; index < options.length; index++) {
    if (options[index] === "--once") once = true;
    else if (options[index] === "--strict-verdict") strictVerdict = true;
    else if (options[index] === "--workspace-root" && options[index + 1]) {
      workspaceRoot = resolve(options[++index]);
    } else if (
      ["--cursor", "-c", "--claude", "--codex", "--copilot", "--opencode"]
        .includes(
          options[index],
        )
    ) {
      continue;
    } else throw new Error(`Unknown until option: ${options[index]}`);
  }
  const parsed = parseUntilConfig(
    JSON.parse(await Deno.readTextFile(resolve(configPath))),
  );
  if (command === "validate") {
    console.log(`Valid gambit config with ${parsed.gambits.length} gambit(s).`);
    return;
  }
  const agent = resolveAgentHarnessFromFlagsAndEnv({
    agent: globalAgent,
    ...agentFlags,
  });
  const sandboxFlag = resolveSandboxFlagValue(globalSandbox, localSandbox);
  const resolvedSandbox = parsed.sandbox
    ? (() => {
      const provider = resolveSandboxProvider({
        cliFlag: sandboxFlag,
        envProvider: Deno.env.get("DN_SANDBOX_PROVIDER") ?? null,
        configProvider: parsed.sandbox.provider,
      });
      return {
        provider,
        config: withSandboxProvider(parsed.sandbox, provider),
      };
    })()
    : await resolveSandboxConfig(workspaceRoot, sandboxFlag);
  resolvedSandbox.config = withGambitSecrets(
    resolvedSandbox.config,
    parsed.gambits,
  );
  await runWithSandboxLifecycle(
    { repoRoot: workspaceRoot, ...resolvedSandbox },
    async () => {
      for (const gambit of parsed.gambits) {
        await runGambit(gambit, workspaceRoot, agent, { once, strictVerdict });
      }
    },
  );
}
