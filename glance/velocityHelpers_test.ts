// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import {
  asciiFilledBar,
  trendDirectionFromCounts,
  truncateWithEllipsis,
} from "./velocityHelpers.ts";

Deno.test("trendDirectionFromCounts flags increase", () => {
  assertEquals(trendDirectionFromCounts(10, 2), "up");
});

Deno.test("trendDirectionFromCounts flags decrease", () => {
  assertEquals(trendDirectionFromCounts(2, 10), "down");
});

Deno.test("trendDirectionFromCounts flat when delta small", () => {
  assertEquals(trendDirectionFromCounts(5, 5), "flat");
  assertEquals(trendDirectionFromCounts(6, 5), "flat");
});

Deno.test("truncateWithEllipsis leaves short titles", () => {
  assertEquals(truncateWithEllipsis("hello", 10), "hello");
});

Deno.test("truncateWithEllipsis adds ellipsis when needed", () => {
  assertEquals(truncateWithEllipsis("abcdefghi", 5), "abcd…");
});

Deno.test("asciiFilledBar renders bounded width", () => {
  const bar = asciiFilledBar(0.5, 4);
  assertEquals(bar.startsWith("[=="), true);
  assertEquals(bar.endsWith("]"), true);
});
