// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn release delete — Delete a GitHub release.
 */

import { deleteRelease, getReleaseByTag, resolveRepo } from "./api.ts";

function showUsage(): void {
  console.error("dn release delete - Delete a release\n");
  console.error("Usage:");
  console.error("  dn release delete <tag>\n");
  console.error("Arguments:");
  console.error("  <tag>             Release tag name\n");
  console.error("Options:");
  console.error("  -R <owner/repo>   Repository override");
  console.error("  --help, -h        Show this help message\n");
  console.error("Examples:");
  console.error("  dn release delete v1.2.3");
}

export async function handleDelete(args: string[]): Promise<void> {
  let tagRef: string | null = null;
  let repoOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showUsage();
      return;
    } else if (arg === "-R" && i + 1 < args.length) {
      repoOverride = args[++i];
    } else if (!arg.startsWith("-") && !tagRef) {
      tagRef = arg;
    }
  }

  if (!tagRef) {
    console.error("Error: Release tag name required");
    showUsage();
    Deno.exit(1);
  }

  const { owner, repo } = await resolveRepo(repoOverride);
  const release = await getReleaseByTag(owner, repo, tagRef);

  await deleteRelease(owner, repo, release.id);

  console.log(`Deleted release ${release.tagName}`);
}
