// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { reviewFailureDocument } from "./reviewCliError.ts";

Deno.test("reviewFailureDocument maps unknown options", () => {
  const doc = reviewFailureDocument(new Error("Unknown option: --merge"));
  assertEquals(doc.error.code, "unknown-option");
});
