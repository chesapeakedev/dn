import { assertEquals } from "@std/assert";
import { scrubSecrets } from "./secretScrub.ts";

Deno.test("scrubSecrets redacts github PAT patterns", () => {
  const token = "ghp_" + "A".repeat(36);
  const result = scrubSecrets(`token=${token} here`);
  assertEquals(result.redactionCount >= 1, true);
  assertEquals(result.text.includes(token), false);
  assertEquals(result.text.includes("[REDACTED]"), true);
});
