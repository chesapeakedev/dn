// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * CLI output policy and formatting.
 * Re-exports TTY, spinner, elapsed time, and branded formatters from the SDK.
 */

import { bootstrapFromEnv as sdkBootstrapFromEnv } from "../sdk/github/output.ts";

export {
  configureForCI,
  formatDetail,
  formatElapsedTime,
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
  isAgentTraceEnabled,
  isCI,
  isColorEnabled,
  isTty,
  isUnattended,
  printSeparator,
  setAgentTrace,
  setUnattended,
  shouldBrandDn,
  Spinner,
} from "../sdk/github/output.ts";

/**
 * Bootstrap output policy at CLI entry. Call with no args first (applies CI NO_COLOR),
 * then with parsed global flags after parsing --unattended, --no-color, --color,
 * --trace / --no-trace.
 */
export function bootstrapFromEnv(opts?: {
  unattended?: boolean;
  noColor?: boolean;
  forceColor?: boolean;
  agentTrace?: boolean;
}): void {
  sdkBootstrapFromEnv(opts);
}
