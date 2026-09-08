// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  applyIssueSplit,
  parseIssueSplitDecision,
  parseIssueSplitProposal,
} from "./issueSplit.ts";

const result = (number: number) => ({
  id: String(number),
  number,
  title: `issue ${number}`,
  body: "",
  url: `https://github.com/acme/app/issues/${number}`,
  state: "OPEN",
});

Deno.test("parseIssueSplitProposal requires exactly two complete issue records", () => {
  assertEquals(
    parseIssueSplitProposal({
      original: { title: "A", body: "a" },
      child: { title: "B", body: "b" },
      rationale: "Separate concerns",
    }).child.title,
    "B",
  );
  assertThrows(() =>
    parseIssueSplitProposal({
      original: { title: "A", body: "a" },
      rationale: "missing child",
    })
  );
});

Deno.test("agent decisions can reject artificial splits with a rationale", () => {
  assertEquals(
    parseIssueSplitDecision({
      split: false,
      rationale:
        "The work shares one migration and splitting it would add coordination overhead.",
    }),
    {
      split: false,
      rationale:
        "The work shares one migration and splitting it would add coordination overhead.",
    },
  );
});

Deno.test("applyIssueSplit creates child, updates original, then attaches child", async () => {
  const calls: string[] = [];
  const output = await applyIssueSplit(
    parseIssueSplitProposal({
      original: { title: "A", body: "a" },
      child: { title: "B", body: "b" },
      rationale: "Separate concerns",
    }),
    { labels: ["bug"], milestoneId: "milestone-1" },
    {
      createIssue: (options) => {
        calls.push(`create:${options.title}:${options.milestoneId}`);
        return Promise.resolve(result(2));
      },
      updateIssue: (options) => {
        calls.push(`update:${options.title}`);
        return Promise.resolve(result(1));
      },
      addSubIssue: (number) => {
        calls.push(`attach:${number}`);
        return Promise.resolve();
      },
    },
  );
  assertEquals(calls, ["create:B:milestone-1", "update:A", "attach:2"]);
  assertEquals(output.relationship, "attached");
});

Deno.test("applyIssueSplit reports relationship failures after mutations", async () => {
  const output = await applyIssueSplit(
    parseIssueSplitProposal({
      original: { title: "A", body: "a" },
      child: { title: "B", body: "b" },
      rationale: "Separate concerns",
    }),
    {},
    {
      createIssue: () => Promise.resolve(result(2)),
      updateIssue: () => Promise.resolve(result(1)),
      addSubIssue: () => {
        throw new Error("permission denied");
      },
    },
  );
  assert(output.original.number === 1);
  assertEquals(output.relationship, "failed");
  assertEquals(output.relationshipError, "permission denied");
});
