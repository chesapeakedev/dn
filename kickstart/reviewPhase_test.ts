// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  countDiffLines,
  decideReviewSkip,
  DEFAULT_REVIEW_AUTO_SKIP_MAX_LINES,
  resolveReviewPrompt,
} from "./reviewPhase.ts";

Deno.test("countDiffLines ignores headers and counts +/- lines", () => {
  const diff = [
    "diff --git a/foo.ts b/foo.ts",
    "--- a/foo.ts",
    "+++ b/foo.ts",
    "+added",
    "-removed",
    " context",
  ].join("\n");
  assertEquals(countDiffLines(diff), 2);
});

Deno.test("decideReviewSkip skips when review config absent", () => {
  const decision = decideReviewSkip({ reviewConfig: null, diff: "+a\n-b\n" });
  assertEquals(decision.skip, true);
  assertEquals(decision.reason, "no_config");
});

Deno.test("decideReviewSkip respects flag, env, and small diff", () => {
  const reviewConfig = { prompt: "Review carefully." };
  const bigDiff = Array.from({ length: 101 }, (_, i) => `+line${i}`).join(
    "\n",
  );

  assertEquals(
    decideReviewSkip({
      reviewConfig,
      diff: bigDiff,
      skipReviewFlag: true,
    }).reason,
    "explicit_skip",
  );

  assertEquals(
    decideReviewSkip({
      reviewConfig,
      diff: bigDiff,
      env: { DN_SKIP_REVIEW: "true" },
    }).reason,
    "env_skip",
  );

  assertEquals(
    decideReviewSkip({
      reviewConfig,
      diff: "+only\n",
      skipForSingleLand: true,
    }).reason,
    "single_land",
  );

  const small = decideReviewSkip({
    reviewConfig,
    diff: "+a\n+b\n",
  });
  assertEquals(small.skip, true);
  assertEquals(small.reason, "small_diff");
  assertEquals(small.autoSkipMaxLines, DEFAULT_REVIEW_AUTO_SKIP_MAX_LINES);

  const run = decideReviewSkip({ reviewConfig, diff: bigDiff });
  assertEquals(run.skip, false);
  assertEquals(run.reason, null);
});

Deno.test("resolveReviewPrompt reads file when path exists", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dn-review-" });
  const path = join(dir, ".dn", "review.md");
  await Deno.mkdir(join(dir, ".dn"), { recursive: true });
  await Deno.writeTextFile(path, "# Review\n\nCheck edge cases.\n");
  const resolved = await resolveReviewPrompt(dir, ".dn/review.md");
  assertEquals(resolved.source, "file");
  assertEquals(resolved.content.includes("edge cases"), true);
  assertEquals(resolved.warnShortPrompt, false);
});

Deno.test("resolveReviewPrompt treats missing path as inline", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dn-review-" });
  const resolved = await resolveReviewPrompt(dir, "Focus on tests.");
  assertEquals(resolved.source, "inline");
  assertEquals(resolved.content, "Focus on tests.");
});

Deno.test("resolveReviewPrompt warns on short file content", async () => {
  const dir = await Deno.makeTempDir({ prefix: "dn-review-" });
  const path = join(dir, "tiny.md");
  await Deno.writeTextFile(path, "  ");
  const resolved = await resolveReviewPrompt(dir, "tiny.md");
  assertEquals(resolved.warnShortPrompt, true);
});
