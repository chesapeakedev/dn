// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Goal-driven generator/verifier workflows. */

import { resolve } from "@std/path";
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

/** A generator or verifier action. Exactly one of prompt and script is required. */
export interface HcAction {
  prompt?: string;
  script?: string;
}

/** A bounded generator/verifier workflow. */
export interface GambitConfig {
  name?: string;
  generator: HcAction;
  verifier: HcAction;
  generator_interval_ms: number;
  verifier_interval_ms: number;
  max_iterations: number;
  timeout_ms: number;
  one_shot: boolean;
  metadata: Record<string, string>;
  secrets: string[];
}

/** Parsed contents of a gambit JSON file. */
export interface HcConfig {
  sandbox?: DnSandboxConfig;
  gambits: GambitConfig[];
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(
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

function parseAction(value: unknown, field: string): HcAction {
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

function parseStringRecord(
  value: unknown,
  field: string,
): Record<string, string> {
  if (value === undefined) return {};
  const values = record(value, field);
  for (const [key, item] of Object.entries(values)) {
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
    verifier: parseAction(gambit.verifier, `gambits[${index}].verifier`),
    generator_interval_ms: positiveInteger(
      gambit.generator_interval_ms,
      `gambits[${index}].generator_interval_ms`,
      0,
    ),
    verifier_interval_ms: positiveInteger(
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
export function parseHcConfig(value: unknown): HcConfig {
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

async function runAction(
  action: HcAction,
  workspaceRoot: string,
  agent: AgentHarness,
): Promise<ExecResult> {
  if (action.script) return await runScript(action.script, workspaceRoot);
  const promptPath = await Deno.makeTempFile({
    dir: workspaceRoot,
    prefix: ".dn-hc-",
    suffix: ".md",
  });
  try {
    await Deno.writeTextFile(promptPath, action.prompt!);
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

function verifierSucceeded(action: HcAction, result: ExecResult): boolean {
  if (action.script) return result.code === 0;
  if (result.code !== 0) return false;
  try {
    const verdict = JSON.parse(result.stdout) as { done?: unknown };
    return verdict.done === true;
  } catch {
    throw new Error(
      'prompt verifier must print JSON exactly like {"done": true}',
    );
  }
}

/** Runs one gambit. Script verifiers succeed on exit code 0; prompt verifiers must print JSON. */
export async function runGambit(
  gambit: GambitConfig,
  workspaceRoot: string,
  agent: AgentHarness,
  once: boolean,
): Promise<void> {
  const startedAt = Date.now();
  const limit = once || gambit.one_shot ? 1 : gambit.max_iterations;
  for (let iteration = 1; iteration <= limit; iteration++) {
    if (Date.now() - startedAt > gambit.timeout_ms) {
      throw new Error(`Gambit ${gambit.name ?? "unnamed"} timed out`);
    }
    console.log(
      `hc ${
        gambit.name ?? "gambit"
      }: generator iteration ${iteration}/${limit}`,
    );
    const generator = await runAction(gambit.generator, workspaceRoot, agent);
    if (generator.code !== 0) {
      throw new Error(
        `Generator failed with exit code ${generator.code}: ${generator.stderr}`,
      );
    }
    await sleep(gambit.verifier_interval_ms);
    const verifier = await runAction(gambit.verifier, workspaceRoot, agent);
    if (verifierSucceeded(gambit.verifier, verifier)) {
      console.log(`hc ${gambit.name ?? "gambit"}: verifier reported done`);
      return;
    }
    if (iteration < limit) await sleep(gambit.generator_interval_ms);
  }
  throw new Error(
    `Gambit ${
      gambit.name ?? "unnamed"
    } did not complete within ${limit} iteration(s)`,
  );
}

function showHelp(): void {
  console.log(
    'dn hc - Run bounded generator/verifier gambits\n\nUsage:\n  dn hc validate <gambit.json>\n  dn hc run <gambit.json> [--once] [--workspace-root <path>]\n\nA gambit has generator and verifier actions. Each action has exactly one of prompt or script. Script verifiers report done with exit code 0; prompt verifiers must emit {"done": true}.\n',
  );
}

/** Handles the `dn hc` command. */
export async function handleHc(
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
    throw new Error("Usage: dn hc <validate|run> <gambit.json>");
  }
  let once = false;
  let workspaceRoot = Deno.cwd();
  const agentFlags = parseAgentHarnessFlagsFromArgs(options);
  for (let index = 0; index < options.length; index++) {
    if (options[index] === "--once") once = true;
    else if (options[index] === "--workspace-root" && options[index + 1]) {
      workspaceRoot = resolve(options[++index]);
    } else if (
      ["--cursor", "-c", "--claude", "--codex", "--copilot", "--opencode"]
        .includes(
          options[index],
        )
    ) {
      continue;
    } else throw new Error(`Unknown hc option: ${options[index]}`);
  }
  const parsed = parseHcConfig(
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
        await runGambit(
          gambit,
          workspaceRoot,
          agent,
          once,
        );
      }
    },
  );
}
