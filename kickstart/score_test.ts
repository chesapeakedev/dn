// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { normalizeScoringRef } from "./score.ts";

Deno.test("normalizeScoringRef keeps bare issue numbers", () => {
  assertEquals(normalizeScoringRef("12"), "12");
  assertEquals(normalizeScoringRef(" 7 "), "7");
});

Deno.test("normalizeScoringRef accepts #N and issue URLs", () => {
  assertEquals(normalizeScoringRef("#3"), "3");
  assertEquals(
    normalizeScoringRef(
      "https://github.com/chesapeakedev/hoteling-demo-nick/issues/1",
    ),
    "1",
  );
  assertEquals(
    normalizeScoringRef(
      "https://github.com/o/r/issues/42?foo=1",
    ),
    "42",
  );
});
