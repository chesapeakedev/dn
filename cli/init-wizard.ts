// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * `dn init wizard` — guided first-run setup for project and user configuration.
 */

import { join } from "@std/path";
import { $ } from "$dax";
import { handleInitAgents } from "./init-agents.ts";
import { handleRfc } from "./rfc.ts";
import { formatInfo, formatSuccess } from "./output.ts";
import {
  AGENT_HARNESSES,
  type AgentHarness,
} from "../sdk/github/agentHarness.ts";
import {
  confirmCreateFile,
  confirmMergeIntoExisting,
  dnAutoApproved,
  promptYesNo,
} from "../sdk/github/filePrompt.ts";
import { isUnattended } from "../sdk/github/output.ts";
import {
  DN_LEGACY_CONFIG_PATH,
  DN_REPOSITORY_CONFIG_PATH,
  resolveDnConfig,
} from "../sdk/config/mod.ts";
import { parseDnConfig } from "../sdk/config/parse.ts";
import type { DnConfigLayer, DnStrictConfig } from "../sdk/config/types.ts";
import { writeActionsConfigProjection } from "../sdk/config/actions.ts";
import {
  DEFAULT_SANDBOX_CONFIG,
  parseDnSandboxConfig,
} from "../sdk/sandbox/config.ts";
import type { SandboxProvider } from "../sdk/sandbox/types.ts";
import {
  installWorkflowSupport,
  installWorkflowTemplates,
} from "../sdk/workflows/mod.ts";

const SKILL_AGENTS = ["codex", "claude", "opencode", "cursor"] as const;
type SkillAgent = (typeof SKILL_AGENTS)[number];

const SANDBOX_PROVIDERS: readonly SandboxProvider[] = [
  "none",
  "docker",
  "exe.dev",
];

interface InitWizardOptions {
  forceUser: boolean;
  forceProject: boolean;
  autoYes: boolean;
  json: boolean;
}

interface WizardContext {
  mode: "project" | "user";
  repoRoot: string | null;
}

interface WizardSelections {
  agent: AgentHarness;
  sandboxProvider: SandboxProvider;
  /** When true, persist strict.require_rfcs (and derive strict.enabled). */
  requireRfcs: boolean;
  initRfc: boolean;
  installWorkflows: boolean;
  installSkill: boolean;
}

function defaultUserConfigPath(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  return home ? join(home, ".dn", "config.json") : join(".dn", "config.json");
}

function isSkillAgent(agent: AgentHarness): agent is SkillAgent {
  return (SKILL_AGENTS as readonly string[]).includes(agent);
}

function showHelp(): void {
  console.log("dn init wizard - Guided dn setup for a machine or repository\n");
  console.log("Usage:");
  console.log("  dn init wizard [options]\n");
  console.log("Description:");
  console.log(
    "  Runs an interactive first-run wizard. Inside a VCS checkout, configures",
  );
  console.log(
    "  project dn.json (and optional GitHub Actions projection). Outside a",
  );
  console.log(
    "  repository, configures personal defaults in ~/.dn/config.json.\n",
  );
  console.log("Options:");
  console.log(
    "  --project           Force project mode (requires VCS checkout)",
  );
  console.log("  --user              Force user mode (~/.dn/config.json)");
  console.log(
    "  --yes, -y           Accept defaults and skip optional prompts",
  );
  console.log("  --json              Print machine-readable summary");
  console.log("  --help, -h          Show this help message\n");
  console.log("Examples:");
  console.log("  dn init wizard");
  console.log("  dn init wizard --project --yes");
  console.log("  DN_YES=1 dn init wizard --user");
}

function parseInitWizardOptions(args: string[]): InitWizardOptions {
  const options: InitWizardOptions = {
    forceUser: false,
    forceProject: false,
    autoYes: dnAutoApproved(false),
    json: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else if (arg === "--user") {
      options.forceUser = true;
    } else if (arg === "--project") {
      options.forceProject = true;
    } else if (arg === "--yes" || arg === "-y") {
      options.autoYes = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.forceUser && options.forceProject) {
    throw new Error("Cannot pass both --user and --project");
  }

  return options;
}

async function resolveRepoRoot(): Promise<string | null> {
  try {
    // Probe quietly — missing checkout is a normal outcome for user mode.
    return (await $`sl root`.quiet().text()).trim();
  } catch {
    try {
      return (await $`git rev-parse --show-toplevel`.quiet().text()).trim();
    } catch {
      return null;
    }
  }
}

async function resolveWizardContext(
  options: InitWizardOptions,
): Promise<WizardContext> {
  // --user never needs a checkout; skip VCS probes entirely.
  if (options.forceUser) {
    return { mode: "user", repoRoot: null };
  }

  const repoRoot = await resolveRepoRoot();

  if (options.forceProject) {
    if (!repoRoot) {
      throw new Error(
        "Project mode requires a git or sapling checkout. Run from a repository or omit --project.",
      );
    }
    return { mode: "project", repoRoot };
  }

  if (repoRoot) {
    return { mode: "project", repoRoot };
  }

  return { mode: "user", repoRoot: null };
}

async function readOptionalConfig(path: string): Promise<DnConfigLayer | null> {
  try {
    return parseDnConfig(await Deno.readTextFile(path), path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function promptChoice<T extends string>(
  message: string,
  choices: readonly T[],
  defaultValue: T,
  autoYes: boolean,
): T {
  if (isUnattended() || autoYes) {
    return defaultValue;
  }

  console.log(message);
  for (const [index, choice] of choices.entries()) {
    const marker = choice === defaultValue ? " (default)" : "";
    console.log(`  ${index + 1}. ${choice}${marker}`);
  }

  const input = typeof globalThis.prompt === "function"
    ? prompt(`Choose [1-${choices.length}]: `)?.trim()
    : undefined;

  if (input === undefined || input === "") {
    return defaultValue;
  }

  const numeric = Number.parseInt(input, 10);
  if (
    Number.isFinite(numeric) && numeric >= 1 && numeric <= choices.length
  ) {
    return choices[numeric - 1];
  }

  const normalized = input.toLowerCase();
  const match = choices.find((choice) => choice.toLowerCase() === normalized);
  return match ?? defaultValue;
}

function promptOptionalStep(
  message: string,
  defaultYes: boolean,
  autoYes: boolean,
): boolean {
  if (autoYes || dnAutoApproved(autoYes) || isUnattended()) {
    return defaultYes;
  }
  return promptYesNo(message, {
    defaultYes,
    autoApproveIfUnattended: false,
    unattendedHint: "pass --yes (or set DN_YES=1) to accept defaults.",
  });
}

async function loadExistingDefaults(
  context: WizardContext,
  userConfigPath: string,
): Promise<{ agent: AgentHarness; sandboxProvider: SandboxProvider }> {
  if (context.mode === "project" && context.repoRoot) {
    const resolved = await resolveDnConfig({
      repoRoot: context.repoRoot,
      userConfigPath,
      includeUser: false,
      env: {},
    });
    return {
      agent: resolved.agent ?? "opencode",
      sandboxProvider: resolved.sandbox?.provider ?? "none",
    };
  }

  const userConfig = await readOptionalConfig(userConfigPath);
  return {
    agent: userConfig?.defaults?.agent ?? userConfig?.agent ?? "opencode",
    sandboxProvider: userConfig?.defaults?.sandbox?.provider ??
      userConfig?.sandbox?.provider ??
      "none",
  };
}

async function collectSelections(
  context: WizardContext,
  options: InitWizardOptions,
  userConfigPath: string,
): Promise<WizardSelections> {
  const defaults = await loadExistingDefaults(context, userConfigPath);

  let existingProject: DnConfigLayer | null = null;
  if (context.mode === "project" && context.repoRoot) {
    existingProject = await loadExistingProjectConfig(context.repoRoot);
    if (existingProject) {
      console.log(formatInfo("Found existing project configuration."));
    }
  } else {
    const existingUser = await readOptionalConfig(userConfigPath);
    if (existingUser) {
      console.log(
        formatInfo(`Found existing user config at ${userConfigPath}.`),
      );
    }
  }

  const agent = promptChoice(
    "Preferred agent harness:",
    AGENT_HARNESSES,
    defaults.agent,
    options.autoYes,
  );

  const sandboxProvider = promptChoice(
    "Default sandbox provider:",
    SANDBOX_PROVIDERS,
    defaults.sandboxProvider,
    options.autoYes,
  );

  const requireRfcs = context.mode === "project"
    ? promptOptionalStep(
      "Require a promoted RFC before dn kickstart / dn meld?",
      existingProject?.strict?.require_rfcs === true,
      options.autoYes,
    )
    : false;

  const initRfc = context.mode === "project"
    ? promptOptionalStep(
      "Initialize RFC corpus with dn rfc init?",
      false,
      options.autoYes,
    )
    : false;

  const installWorkflows = context.mode === "project"
    ? promptOptionalStep(
      "Install GitHub Actions workflows and project .github/dn/config.json?",
      false,
      options.autoYes,
    )
    : false;

  const installSkill = promptOptionalStep(
    context.mode === "project"
      ? "Install the dn skill for this agent in the repository?"
      : "Install the dn skill for this agent in your home directory?",
    false,
    options.autoYes,
  );

  return {
    agent,
    sandboxProvider,
    requireRfcs,
    initRfc,
    installWorkflows,
    installSkill,
  };
}

/**
 * Builds the project `strict` block from concrete policy selections.
 *
 * `enabled` is derived: it is set only when at least one enforceable policy
 * (today: `require_rfcs`) is on. A bare `{ enabled: true }` is never written.
 */
export function buildStrictConfig(
  requireRfcs: boolean,
  existing: DnStrictConfig | undefined,
): DnStrictConfig | undefined {
  if (requireRfcs) {
    return {
      ...existing,
      enabled: true,
      require_rfcs: true,
    };
  }
  return undefined;
}

async function loadExistingProjectConfig(
  repoRoot: string,
): Promise<DnConfigLayer | null> {
  const projectPath = join(repoRoot, DN_REPOSITORY_CONFIG_PATH);
  const existing = await readOptionalConfig(projectPath);
  if (existing) return existing;
  return await readOptionalConfig(join(repoRoot, DN_LEGACY_CONFIG_PATH));
}

function buildSandboxConfig(provider: SandboxProvider) {
  if (provider === "none") {
    return parseDnSandboxConfig({ provider: "none" });
  }
  return {
    ...parseDnSandboxConfig({ provider }),
    ...(provider === "docker"
      ? {
        docker: {
          image: DEFAULT_SANDBOX_CONFIG.docker.image,
          network: DEFAULT_SANDBOX_CONFIG.docker.network,
          read_only_root: DEFAULT_SANDBOX_CONFIG.docker.read_only_root,
          mounts: DEFAULT_SANDBOX_CONFIG.docker.mounts.map((mount) => ({
            ...mount,
          })),
          env_pass_through: [
            ...DEFAULT_SANDBOX_CONFIG.docker.env_pass_through,
          ],
        },
      }
      : {}),
    ...(provider === "exe.dev"
      ? {
        exe_dev: {
          image: DEFAULT_SANDBOX_CONFIG.exe_dev.image,
          vm_name_prefix: DEFAULT_SANDBOX_CONFIG.exe_dev.vm_name_prefix,
          ttl: DEFAULT_SANDBOX_CONFIG.exe_dev.ttl,
          integrations: [...DEFAULT_SANDBOX_CONFIG.exe_dev.integrations],
        },
      }
      : {}),
  };
}

async function writeProjectConfig(
  repoRoot: string,
  selections: WizardSelections,
  autoYes: boolean,
): Promise<string> {
  const path = join(repoRoot, DN_REPOSITORY_CONFIG_PATH);
  const existing = await readOptionalConfig(path);
  if (
    !optionsAllowWrite(path, autoYes, existing !== null)
  ) {
    throw new Error(`Cancelled updating ${DN_REPOSITORY_CONFIG_PATH}.`);
  }

  const strict = buildStrictConfig(selections.requireRfcs, existing?.strict);

  const document: DnConfigLayer = {
    schema_version: "2.0",
    agent: selections.agent,
    sandbox: buildSandboxConfig(selections.sandboxProvider),
    ...(strict ? { strict } : {}),
    ...(existing?.rfc ? { rfc: existing.rfc } : {}),
  };

  await Deno.writeTextFile(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
}

async function writeUserConfig(
  userConfigPath: string,
  selections: WizardSelections,
  autoYes: boolean,
): Promise<string> {
  const existing = await readOptionalConfig(userConfigPath);
  if (
    !optionsAllowWrite(userConfigPath, autoYes, existing !== null)
  ) {
    throw new Error("Cancelled updating user config.");
  }

  const document: DnConfigLayer = {
    schema_version: "2.0",
    defaults: {
      agent: selections.agent,
      sandbox: buildSandboxConfig(selections.sandboxProvider),
    },
    ...(existing?.repos ? { repos: existing.repos } : {}),
  };

  await Deno.mkdir(join(userConfigPath, ".."), { recursive: true });
  await Deno.writeTextFile(
    userConfigPath,
    `${JSON.stringify(document, null, 2)}\n`,
  );
  return userConfigPath;
}

function optionsAllowWrite(
  displayPath: string,
  autoYes: boolean,
  exists: boolean,
): boolean {
  if (exists) {
    return confirmMergeIntoExisting(displayPath, autoYes);
  }
  return confirmCreateFile(displayPath, autoYes);
}

async function withRepoRoot<T>(
  repoRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Deno.cwd();
  try {
    Deno.chdir(repoRoot);
    return await run();
  } finally {
    Deno.chdir(previous);
  }
}

async function runOptionalSteps(
  context: WizardContext,
  selections: WizardSelections,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  if (context.mode === "project" && context.repoRoot) {
    await withRepoRoot(context.repoRoot, async () => {
      if (selections.initRfc) {
        await handleRfc(["init"]);
        results.rfc_init = true;
      }

      if (selections.installWorkflows) {
        await installWorkflowSupport(context.repoRoot!, {
          agent: selections.agent,
        });
        await installWorkflowTemplates(context.repoRoot!, {
          updateExisting: false,
        });
        const projection = await writeActionsConfigProjection(
          context.repoRoot!,
        );
        results.workflows = {
          projection_path: projection.path,
          projection_written: projection.written,
        };
      } else {
        const projection = await writeActionsConfigProjection(
          context.repoRoot!,
        );
        if (!projection.skipped) {
          results.projection_path = projection.path;
          results.projection_written = projection.written;
        }
      }
    });
  }

  if (selections.installSkill) {
    if (!isSkillAgent(selections.agent)) {
      console.log(
        formatInfo(
          `Skipping skill install: ${selections.agent} has no supported skill target.`,
        ),
      );
      results.skill = { skipped: true, reason: "unsupported_agent" };
    } else {
      const scope = context.mode === "project" ? "repo" : "user";
      const repoRoot = context.repoRoot ?? Deno.cwd();
      await withRepoRoot(repoRoot, async () => {
        await handleInitAgents([
          "--skill",
          "--agent",
          selections.agent,
          "--scope",
          scope,
        ]);
      });
      results.skill = { installed: true, scope, agent: selections.agent };
    }
  }

  return results;
}

function printSummary(
  context: WizardContext,
  configPath: string,
  selections: WizardSelections,
  optionalResults: Record<string, unknown>,
  options: InitWizardOptions,
): void {
  const payload = {
    mode: context.mode,
    config_path: configPath,
    agent: selections.agent,
    sandbox_provider: selections.sandboxProvider,
    require_rfcs: selections.requireRfcs,
    optional: optionalResults,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("");
  console.log(formatSuccess("Wizard complete."));
  console.log(`Mode: ${context.mode}`);
  console.log(`Wrote: ${configPath}`);
  console.log(`Agent: ${selections.agent}`);
  console.log(`Sandbox: ${selections.sandboxProvider}`);

  if (context.mode === "user") {
    console.log("");
    console.log(
      "Personal defaults apply on this machine. Repository dn.json overrides them inside a checkout.",
    );
    console.log("Run `dn auth` if you have not signed in to GitHub yet.");
  } else {
    console.log("");
    console.log(
      "Commit dn.json and any installed .github/ files so teammates and CI share the same settings.",
    );
  }
}

/**
 * Runs the guided init wizard for project or user configuration.
 */
export async function handleInitWizard(args: string[]): Promise<void> {
  const options = parseInitWizardOptions(args);
  const context = await resolveWizardContext(options);
  const userConfigPath = defaultUserConfigPath();

  console.log(
    formatInfo(
      context.mode === "project"
        ? "Project setup — configuring repository dn.json"
        : "User setup — configuring ~/.dn/config.json",
    ),
  );

  const selections = await collectSelections(context, options, userConfigPath);

  const configPath = context.mode === "project"
    ? await writeProjectConfig(context.repoRoot!, selections, options.autoYes)
    : await writeUserConfig(userConfigPath, selections, options.autoYes);

  const optionalResults = await runOptionalSteps(context, selections);
  printSummary(context, configPath, selections, optionalResults, options);
}
