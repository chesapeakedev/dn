// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

export {
  toActionsProjectionDocument,
  toDnActionsConfig,
  writeActionsConfigProjection,
} from "./actions.ts";
export type {
  DnActionsConfig,
  DnActionsProjectionDocument,
  WriteActionsConfigProjectionOptions,
  WriteActionsConfigProjectionResult,
} from "./actions.ts";
export { resolveLocalAgentHarness } from "./localAgent.ts";
export type { ResolveLocalAgentHarnessOptions } from "./localAgent.ts";
export { ENSURE_RECIPE_NAME_PATTERN, parseDnConfig } from "./parse.ts";
export {
  checkStrictRfcCorpus,
  enforceStrictRfcCorpus,
  isStrictRfcRequired,
} from "./strict.ts";
export type { StrictRfcCheckResult } from "./strict.ts";
export {
  DN_LEGACY_CONFIG_PATH,
  DN_REPOSITORY_CONFIG_PATH,
  resolveDnConfig,
} from "./resolve.ts";
export type {
  DnConfigLayer,
  DnConfigSource,
  DnEnsureConfig,
  DnEnsureRecipe,
  DnHarnessHints,
  DnRfcConfig,
  DnRuntimeOverrides,
  DnStrictConfig,
  DnSyncConfig,
  DnUserDefaults,
  DnUserRepoOverride,
  ResolvedDnConfig,
  ResolveDnConfigOptions,
} from "./types.ts";
