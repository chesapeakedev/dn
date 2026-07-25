const DEFAULT_SERVER_URL = "https://github.com";
const DEFAULT_API_URL = "https://api.github.com";

function normalizedBase(name: string, fallback: string): string {
  const value = (Deno.env.get(name) ?? fallback).replace(/\/+$/, "");
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    Deno.env.get("GITHUB_ALLOW_INSECURE_HTTP") !== "1"
  ) {
    throw new Error(
      `${name} must use HTTPS unless GITHUB_ALLOW_INSECURE_HTTP=1`,
    );
  }
  return value;
}

/** Return the configured GitHub web origin, optionally with a path. */
export function githubServerUrl(path = ""): string {
  return `${normalizedBase("GITHUB_SERVER_URL", DEFAULT_SERVER_URL)}${path}`;
}

/** Return the configured GitHub REST API origin, optionally with a path. */
export function githubApiUrl(path = ""): string {
  return `${normalizedBase("GITHUB_API_URL", DEFAULT_API_URL)}${path}`;
}

/** Return the configured GitHub GraphQL endpoint. */
export function githubGraphqlUrl(): string {
  return normalizedBase(
    "GITHUB_GRAPHQL_URL",
    `${normalizedBase("GITHUB_API_URL", DEFAULT_API_URL)}/graphql`,
  );
}

/** Parse an issue URL belonging to the configured GitHub web origin. */
export function parseConfiguredIssueUrl(
  value: string,
): { owner: string; repo: string; number: number } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== new URL(githubServerUrl()).origin) return null;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
  return match
    ? { owner: match[1], repo: match[2], number: Number(match[3]) }
    : null;
}

/** Parse a milestone URL belonging to the configured GitHub web origin. */
export function parseConfiguredMilestoneUrl(
  value: string,
): { owner: string; repo: string; number: number } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== new URL(githubServerUrl()).origin) return null;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/milestone\/(\d+)$/);
  return match
    ? { owner: match[1], repo: match[2], number: Number(match[3]) }
    : null;
}
