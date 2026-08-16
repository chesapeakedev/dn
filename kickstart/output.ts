// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Output formatting utilities for kickstart.
 * Re-exports CLI output policy and formatters (TTY, spinners, branding, color-aware formatting).
 */

export {
  bootstrapFromEnv,
  configureForCI,
  formatDetail,
  formatElapsedTime,
  formatError,
  formatInfo,
  formatStep,
  formatSuccess,
  formatWarning,
  isCI,
  isColorEnabled,
  isTty,
  isUnattended,
  printSeparator,
  setUnattended,
  shouldBrandDn,
  Spinner,
} from "../cli/output.ts";
