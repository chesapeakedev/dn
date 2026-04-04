// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn release create — Create a GitHub release.
 *
 * Mirrors gh release create with a compatible CLI surface, but works
 * natively with Sapling repos by using the GitHub REST API for all
 * tag operations instead of requiring git locally.
 *
 * Usage:
 *   dn release create v1.2.3
 *   dn release create v1.2.3 --generate-notes
 *   dn release create v1.2.3 --notes-file CHANGELOG.md ./dist/*.tar.gz
 *   dn release create v1.2.3 --draft --prerelease --title "Beta Release"
 */

import {
  createRelease,
  createTagObject,
  createTagRef,
  generateReleaseNotes,
  resolveRepo,
  resolveTagger,
  resolveTargetSha,
  tagExists,
} from "./api.ts";
import { uploadAssetsAndPublish } from "./assets.ts";
import type { ReleaseCreateOptions } from "./types.ts";

/**
 * Show usage for the release create subcommand.
 */
function showUsage(): void {
  console.error("dn release create - Create a GitHub release\n");
  console.error("Usage:");
  console.error("  dn release create <tag> [files...] [options]\n");
  console.error("Arguments:");
  console.error("  <tag>         Tag name for the release (e.g. v1.2.3)");
  console.error("  [files...]    Asset files to upload\n");
  console.error("Options:");
  console.error(
    "  --target <sha>           Commit SHA to tag (default: current commit)",
  );
  console.error("  --title, -t <string>     Release title");
  console.error("  --notes, -n <string>     Release notes");
  console.error(
    "  --notes-file, -F <file>  Read release notes from file (use '-' for stdin)",
  );
  console.error(
    "  --generate-notes         Auto-generate notes via GitHub API",
  );
  console.error("  --notes-start-tag <tag>  Starting tag for generated notes");
  console.error("  --draft, -d              Save as draft");
  console.error("  --prerelease, -p         Mark as prerelease");
  console.error(
    "  --latest                 Set as latest (default: automatic)",
  );
  console.error(
    "  --verify-tag             Abort if tag already exists on remote",
  );
  console.error(
    "  --discussion-category    Start a discussion in the given category",
  );
  console.error("  -R <owner/repo>          Repository override\n");
  console.error("Examples:");
  console.error("  dn release create v1.2.3 --generate-notes");
  console.error(
    "  dn release create v1.2.3 -F release-notes.md ./dist/*.tar.gz",
  );
  console.error(
    '  dn release create v1.2.3 --title "v1.2.3" --notes "Bugfix release"',
  );
  console.error("  dn release create v1.2.3 --draft --prerelease");
}

/**
 * Parse command-line arguments for release create.
 */
function parseArgs(args: string[]): {
  options: ReleaseCreateOptions;
  positionalFiles: string[];
} {
  const options: ReleaseCreateOptions = {
    tagName: "",
    generateNotes: false,
    draft: false,
    prerelease: false,
    verifyTag: false,
    assets: [],
  };

  const positionalFiles: string[] = [];
  let tagNameConsumed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      showUsage();
      Deno.exit(0);
    }

    if (arg === "--target" && i + 1 < args.length) {
      options.target = args[++i];
    } else if (arg === "--title" && i + 1 < args.length) {
      options.title = args[++i];
    } else if (arg === "-t" && i + 1 < args.length) {
      options.title = args[++i];
    } else if (arg === "--notes" && i + 1 < args.length) {
      options.notes = args[++i];
    } else if (arg === "-n" && i + 1 < args.length) {
      options.notes = args[++i];
    } else if (arg === "--notes-file" && i + 1 < args.length) {
      options.notesFile = args[++i];
    } else if (arg === "-F" && i + 1 < args.length) {
      options.notesFile = args[++i];
    } else if (arg === "--generate-notes") {
      options.generateNotes = true;
    } else if (arg === "--notes-start-tag" && i + 1 < args.length) {
      options.notesStartTag = args[++i];
    } else if (arg === "--draft" || arg === "-d") {
      options.draft = true;
    } else if (arg === "--prerelease" || arg === "-p") {
      options.prerelease = true;
    } else if (arg.startsWith("--latest")) {
      const val = arg.includes("=") ? arg.split("=")[1] : args[++i];
      if (val === "false") {
        options.latest = false;
      } else {
        options.latest = true;
      }
    } else if (arg === "--verify-tag") {
      options.verifyTag = true;
    } else if (arg === "--discussion-category" && i + 1 < args.length) {
      options.discussionCategory = args[++i];
    } else if (arg === "-R" && i + 1 < args.length) {
      options.repoOverride = args[++i];
    } else if (!arg.startsWith("-")) {
      if (!tagNameConsumed) {
        options.tagName = arg;
        tagNameConsumed = true;
      } else {
        positionalFiles.push(arg);
      }
    } else {
      console.error(`Unknown flag: ${arg}`);
      showUsage();
      Deno.exit(1);
    }
  }

  return { options, positionalFiles };
}

/**
 * Read release notes from a file or stdin.
 */
async function readNotesFile(notesFile: string): Promise<string> {
  if (notesFile === "-") {
    const buffer = await new Response(Deno.stdin.readable).arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  }
  return Deno.readTextFile(notesFile);
}

/**
 * Main handler for dn release create.
 */
export async function handleCreate(args: string[]): Promise<void> {
  const { options, positionalFiles } = parseArgs(args);

  if (!options.tagName) {
    console.error("Error: Tag name is required");
    console.error("\nUsage: dn release create <tag> [options]");
    Deno.exit(1);
  }

  if (options.discussionCategory && options.draft) {
    console.error("Error: --discussion-category is not supported with --draft");
    Deno.exit(1);
  }

  // Resolve repo
  const { owner, repo } = await resolveRepo(options.repoOverride);

  // Resolve target commit SHA
  const targetSha = await resolveTargetSha(options.target);

  // Read notes file if provided
  let body = options.notes;
  if (options.notesFile) {
    body = await readNotesFile(options.notesFile);
  }

  // Verify tag if requested
  if (options.verifyTag) {
    const exists = await tagExists(owner, repo, options.tagName);
    if (exists) {
      console.error(
        `Error: Tag ${options.tagName} already exists on ${owner}/${repo}, aborting due to --verify-tag`,
      );
      Deno.exit(1);
    }
  }

  // Generate release notes if requested
  let generatedNotes: { name: string; body: string } | null = null;
  if (options.generateNotes) {
    try {
      generatedNotes = await generateReleaseNotes(owner, repo, {
        tagName: options.tagName,
        targetCommitish: options.target ?? targetSha,
        previousTagName: options.notesStartTag,
      });
    } catch (error) {
      console.error(
        `Warning: Failed to generate release notes: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Merge generated notes with provided body
  if (generatedNotes) {
    const title = options.title ?? generatedNotes.name;
    const mergedBody = body
      ? `${body}\n\n${generatedNotes.body}`
      : generatedNotes.body;
    options.title = title;
    body = mergedBody;
  }

  // Create tag via GitHub API (the Sapling workaround)
  console.error(`Creating tag ${options.tagName} at ${targetSha}...`);

  const tagger = await resolveTagger();
  const tagMessage = body ?? `${options.tagName} release`;

  const tagObject = await createTagObject(owner, repo, {
    tag: options.tagName,
    message: tagMessage,
    object: targetSha,
    type: "commit",
    tagger,
  });

  await createTagRef(owner, repo, {
    tagName: options.tagName,
    sha: tagObject.sha,
  });

  console.error(`Tag ${options.tagName} created.`);

  // Determine if we need to create as draft for asset uploads
  const hasAssets = positionalFiles.length > 0;
  const draftWhileUploading = hasAssets && !options.draft;

  // Create the release
  console.error(`Creating release ${options.tagName}...`);

  const release = await createRelease(owner, repo, {
    tagName: options.tagName,
    targetCommitish: options.target ?? targetSha,
    name: options.title,
    body: body ?? undefined,
    draft: draftWhileUploading,
    prerelease: options.prerelease,
    discussionCategoryName: options.discussionCategory,
    generateReleaseNotes: options.generateNotes && !generatedNotes,
    makeLatest: options.latest === undefined
      ? undefined
      : options.latest
      ? "true"
      : "false",
  });

  // Upload assets if any
  if (hasAssets) {
    const finalRelease = await uploadAssetsAndPublish(
      owner,
      repo,
      release,
      positionalFiles,
      draftWhileUploading,
    );
    console.log(finalRelease.htmlUrl);
  } else {
    console.log(release.htmlUrl);
  }
}
