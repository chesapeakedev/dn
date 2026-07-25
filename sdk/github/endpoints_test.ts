import { assertEquals, assertThrows } from "@std/assert";
import {
  githubApiUrl,
  githubGraphqlUrl,
  githubServerUrl,
  parseConfiguredIssueUrl,
  parseConfiguredMilestoneUrl,
} from "./endpoints.ts";

Deno.test("GitHub endpoints preserve production defaults", () => {
  assertEquals(githubServerUrl(), "https://github.com");
  assertEquals(githubApiUrl(), "https://api.github.com");
  assertEquals(githubGraphqlUrl(), "https://api.github.com/graphql");
  assertEquals(
    parseConfiguredIssueUrl("https://github.com/acme/app/issues/12"),
    { owner: "acme", repo: "app", number: 12 },
  );
});

Deno.test("GitHub URL parsers support an explicitly allowed twin", () => {
  Deno.env.set("GITHUB_SERVER_URL", "http://github-twin:4242");
  Deno.env.set("GITHUB_API_URL", "http://github-twin:4242");
  Deno.env.set("GITHUB_ALLOW_INSECURE_HTTP", "1");
  try {
    assertEquals(
      parseConfiguredIssueUrl("http://github-twin:4242/acme/app/issues/7"),
      { owner: "acme", repo: "app", number: 7 },
    );
    assertEquals(
      parseConfiguredMilestoneUrl(
        "http://github-twin:4242/acme/app/milestone/3",
      ),
      { owner: "acme", repo: "app", number: 3 },
    );
  } finally {
    Deno.env.delete("GITHUB_SERVER_URL");
    Deno.env.delete("GITHUB_API_URL");
    Deno.env.delete("GITHUB_ALLOW_INSECURE_HTTP");
  }
});

Deno.test("GitHub endpoint configuration rejects insecure HTTP", () => {
  Deno.env.set("GITHUB_API_URL", "http://github-twin:4242");
  try {
    assertThrows(() => githubApiUrl(), Error, "must use HTTPS");
  } finally {
    Deno.env.delete("GITHUB_API_URL");
  }
});
