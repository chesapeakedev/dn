// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { matchMilestoneByTitle } from "./milestone.ts";

Deno.test("matchMilestoneByTitle returns number for exact case-insensitive match", () => {
  const milestones = [
    { number: 1, title: "Q1 Features" },
    { number: 2, title: "Q2 Features" },
  ];

  assertEquals(matchMilestoneByTitle(milestones, "q2 features"), 2);
  assertEquals(matchMilestoneByTitle(milestones, "Q1 Features"), 1);
});

Deno.test("matchMilestoneByTitle returns null for ambiguous or missing titles", () => {
  const milestones = [
    { number: 1, title: "Release" },
    { number: 2, title: "Release" },
  ];

  assertEquals(matchMilestoneByTitle(milestones, "Release"), null);
  assertEquals(matchMilestoneByTitle(milestones, "Missing"), null);
  assertEquals(matchMilestoneByTitle(milestones, "   "), null);
});
