import { assertThrows } from "@std/assert";
import { normalizePullRequestUrl } from "./pullRequestReference.ts";

Deno.test("normalizePullRequestUrl accepts canonical GitHub URLs", () => {
  const url = normalizePullRequestUrl(
    "https://github.com/acme/app/pull/42#issuecomment-1",
  );
  if (url !== "https://github.com/acme/app/pull/42") {
    throw new Error(`unexpected: ${url}`);
  }
});

Deno.test("normalizePullRequestUrl rejects bare numbers", () => {
  assertThrows(
    () => normalizePullRequestUrl("42"),
    Error,
    "Bare numbers",
  );
});
