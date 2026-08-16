// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * RFC module exports.
 */

export {
  completeRfc,
  type CompleteRfcResult,
  resolveRfcRef,
} from "./complete.ts";
export {
  computeContentHash,
  createRfcContent,
  parseRfcMetadata,
  readRfc,
  readRfcIfExists,
  updateRfcContent,
  writeRfc,
} from "./parser.ts";
export {
  findRfc,
  getRfcDir,
  getStatePath,
  listRfcsFromState,
  loadState,
  readConfig,
  removeRfcFromState,
  saveState,
  updateRfcInState,
} from "./state.ts";
export type { RfcConfig, RfcRepoOptions } from "./state.ts";
export {
  generateRfcFilename,
  isRfcStatus,
  isValidStatusTransition,
  parseRfcIdFromFilename,
  parseRfcSlugFromFilename,
  RFC_STATUSES,
} from "./types.ts";
export type { Rfc, RfcMetadata, RfcState, RfcStatus } from "./types.ts";
