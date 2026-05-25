// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { isUnattended } from "./output.ts";

/**
 * True when unattended mode accepts automatic yes/no via `--yes` or `DN_YES=1`.
 */
export function dnAutoApproved(autoYesCli: boolean): boolean {
  return autoYesCli || Deno.env.get("DN_YES") === "1";
}

/**
 * Asks `[y/N]` style confirmation when interactive; unattended requires `autoApprove`.
 */
export function promptYesNo(
  message: string,
  options: {
    /** When true and attended, pressing Enter confirms. */
    defaultYes: boolean;
    /** When unattended, must be true to return true. */
    autoApproveIfUnattended: boolean;
    /** Non-interactive reason string for errors */
    unattendedHint: string;
  },
): boolean {
  if (isUnattended()) {
    if (options.autoApproveIfUnattended) {
      return true;
    }
    throw new Error(
      `${message.trim()} Non-interactive mode: ${options.unattendedHint}`,
    );
  }

  const def = options.defaultYes ? "[Y/n]" : "[y/N]";
  const input = typeof globalThis.prompt === "function"
    ? prompt(`${message} ${def}: `)?.trim()?.toLowerCase()
    : undefined;

  if (input === undefined || input === "") {
    return options.defaultYes;
  }

  return input === "y" || input === "yes";
}

/**
 * Confirm creating a new file (default `no` when interactive).
 */
export function confirmCreateFile(
  displayPath: string,
  autoYes: boolean,
): boolean {
  return promptYesNo(`Create new file ${displayPath}?`, {
    defaultYes: false,
    autoApproveIfUnattended: dnAutoApproved(autoYes),
    unattendedHint:
      `pass --yes (or set DN_YES=1) to create ${displayPath} without a prompt.`,
  });
}

/**
 * Confirm merging edits into an existing file (interactive default yes).
 */
export function confirmMergeIntoExisting(
  displayPath: string,
  autoYes: boolean,
): boolean {
  return promptYesNo(
    `Merge sources into existing ${displayPath} without replacing the entire file?`,
    {
      defaultYes: true,
      autoApproveIfUnattended: dnAutoApproved(autoYes),
      unattendedHint:
        `pass --yes (or set DN_YES=1) to confirm merge into existing ${displayPath}.`,
    },
  );
}

/**
 * Confirm replacing an entire existing file (`--overwrite` flow).
 *
 * Interactive default is `no`. Unattended requires `--overwrite` plus `--yes` / DN_YES.
 */
export function confirmDestructiveOverwrite(
  displayPath: string,
  autoYes: boolean,
): boolean {
  return promptYesNo(
    `Overwrite entire file ${displayPath}? (All current content may be replaced)`,
    {
      defaultYes: false,
      autoApproveIfUnattended: dnAutoApproved(autoYes),
      unattendedHint:
        `pass --overwrite with --yes (or DN_YES=1) for non-interactive overwrite of ${displayPath}.`,
    },
  );
}
