// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

export type {
  CommandRunner,
  DnSandboxConfig,
  DockerSandboxConfig,
  ExecOptions,
  ExecResult,
  ExeDevHttpClient,
  ExeDevSandboxConfig,
  SandboxContext,
  SandboxExecContext,
  SandboxHandle,
  SandboxMount,
  SandboxProvider,
  SandboxRunner,
  SandboxSyncConfig,
  SandboxSyncMode,
} from "./types.ts";

export {
  DEFAULT_SANDBOX_CONFIG,
  parseDnSandboxConfig,
  parseSandboxProvider,
  withSandboxProvider,
} from "./config.ts";

export {
  isSandboxDryRun,
  resolveMountSource,
  resolveSandboxConfig,
  resolveSandboxProvider,
} from "./resolve.ts";
export type { SandboxFlagValue } from "./resolve.ts";

export {
  extractSandboxFlag,
  parseGlobalSandboxFlag,
  resolveSandboxFlagValue,
} from "./cli.ts";

export {
  assertSandboxPrerequisites,
  validateSandboxPrerequisites,
} from "./validate.ts";

export {
  createDefaultCommandRunner,
  isDockerAvailable,
  isDockerDaemonAvailable,
  isExeTokenAvailable,
} from "./prerequisites.ts";

export {
  createRunTmpDir,
  getCurrentSandboxContext,
  getWorkspaceTmpDir,
  isSandboxActive,
  setCurrentSandboxContext,
} from "./context.ts";

export { buildGitAddArgv, translateHostPathToSandbox } from "./paths.ts";

export { HostRunner } from "./hostRunner.ts";
export {
  buildDockerRunArgs,
  DockerRunner,
  formatDockerRunCommand,
} from "./dockerRunner.ts";
export { createDefaultExeDevHttpClient, ExeDevRunner } from "./exeDevRunner.ts";
export { createSandboxRunner } from "./factory.ts";
export { runWithSandboxLifecycle } from "./lifecycle.ts";
export { runAgentPhaseInSandbox, translateSandboxCwd } from "./agentPhase.ts";
