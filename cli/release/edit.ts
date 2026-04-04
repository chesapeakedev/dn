// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn release edit — Edit a GitHub release.
 */

import { getReleaseByTag, resolveRepo, updateRelease } from "./api.ts";

function showUsage(): void {
  console.error("dn release edit - Edit a release\n");
  console.error("Usage:");
  console.error("  dn release edit <tag> [options]\n");
  console.error("Arguments:");
  console.error("  <tag>             Release tag name\n");
  console.error("Options:");
  console.error("  --title, -t <string>     New release title");
  console.error("  --notes, -n <string>     New release notes");
  console.error("  --notes-file, -F <file>  Read notes from file");
  console.error("  --draft, -d              Save as draft");
  console.error("  --prerelease, -p         Mark as prerelease");
  console.error("  --latest                 Set as latest");
  console.error("  --json                   Output as JSON");
  console.error("  -R <owner/repo>          Repository override");
  console.error("  --help, -h               Show this help message\n");
  console.error("Examples:");
  console.error('  dn release edit v1.2.3 --title "v1.2.3 Patch"');
  console.error("  dn release edit v1.2.3 --draft");
  console.error("  dn release edit v1.2.3 --notes-file changelog.md");
}

async function readNotesFile(notesFile: string): Promise<string> {
  if (notesFile === "-") {
    const buffer = await new Response(Deno.stdin.readable).arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  }
  return Deno.readTextFile(notesFile);
}

export async function handleEdit(args: string[]): Promise<void> {
  let tagRef: string | null = null;
  let title: string | undefined;
  let notes: string | undefined;
  let notesFile: string | null = null;
  let draft: boolean | undefined;
  let prerelease: boolean | undefined;
  let latest: boolean | undefined;
  let json = false;
  let repoOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showUsage();
      return;
    } else if (arg === "--title" && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === "-t" && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === "--notes" && i + 1 < args.length) {
      notes = args[++i];
    } else if (arg === "-n" && i + 1 < args.length) {
      notes = args[++i];
    } else if (arg === "--notes-file" && i + 1 < args.length) {
      notesFile = args[++i];
    } else if (arg === "-F" && i + 1 < args.length) {
      notesFile = args[++i];
    } else if (arg === "--draft" || arg === "-d") {
      draft = true;
    } else if (arg === "--prerelease" || arg === "-p") {
      prerelease = true;
    } else if (arg.startsWith("--latest")) {
      const val = arg.includes("=") ? arg.split("=")[1] : args[++i];
      latest = val !== "false";
    } else if (arg === "--json") {
      json = true;
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

  if (notesFile) {
    notes = await readNotesFile(notesFile);
  }

  if (
    title === undefined && notes === undefined && draft === undefined &&
    prerelease === undefined && latest === undefined
  ) {
    console.error(
      "Error: At least one of --title, --notes, --draft, --prerelease, or --latest required",
    );
    Deno.exit(1);
  }

  const { owner, repo } = await resolveRepo(repoOverride);
  const release = await getReleaseByTag(owner, repo, tagRef);

  const updated = await updateRelease(owner, repo, release.id, {
    ...(title !== undefined && { name: title }),
    ...(notes !== undefined && { body: notes }),
    ...(draft !== undefined && { draft }),
    ...(prerelease !== undefined && { prerelease }),
    ...(latest !== undefined && { makeLatest: latest ? "true" : "false" }),
  });

  if (json) {
    console.log(JSON.stringify(updated, null, 2));
  } else {
    console.log(`Updated release ${updated.tagName}`);
    console.log(updated.htmlUrl);
  }
}
