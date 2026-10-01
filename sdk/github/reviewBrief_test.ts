import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { canonicalizeReviewData, computeReviewDigest } from "./reviewBrief.ts";
import type { PullRequestReviewData } from "./github-gql.ts";

function sampleData(): PullRequestReviewData {
  return {
    number: 7,
    title: "Add feature",
    body: "Description",
    url: "https://github.com/acme/app/pull/7",
    owner: "acme",
    repo: "app",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    headRefName: "feature",
    headRefOid: "abc",
    baseRefName: "main",
    baseRefOid: "def",
    commits: [{ oid: "abc", message: "change" }],
    files: [{
      path: "src/a.ts",
      additions: 1,
      deletions: 0,
      changeType: "ADDED",
    }],
    comments: [],
    reviews: [],
    reviewThreads: [],
    checks: [{ name: "test", conclusion: "SUCCESS", state: null }],
    warnings: [],
  };
}

Deno.test("review input canonicalization is stable across connection order", async () => {
  const first = sampleData();
  const second = { ...sampleData(), files: [...first.files].reverse() };
  const firstInput = canonicalizeReviewData(first);
  const secondInput = canonicalizeReviewData(second);
  assertEquals(firstInput, secondInput);
  assertEquals(
    await computeReviewDigest(firstInput),
    await computeReviewDigest(secondInput),
  );
});

Deno.test("review digest changes when source identity changes", async () => {
  const original = await computeReviewDigest(
    canonicalizeReviewData(sampleData()),
  );
  const changed = sampleData();
  changed.headRefOid = "different";
  const changedDigest = await computeReviewDigest(
    canonicalizeReviewData(changed),
  );
  assertNotEquals(original, changedDigest);
  assert(original.length === 64);
});
