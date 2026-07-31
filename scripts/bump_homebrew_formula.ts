// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Bump Formula/dn.rb in the collocated homebrew-dn tap to a published release.
 *
 * Usage:
 *   deno run -A scripts/bump_homebrew_formula.ts --version 0.0.35
 *   deno run -A scripts/bump_homebrew_formula.ts --version 0.0.35 --dry-run
 *   deno run -A scripts/bump_homebrew_formula.ts --version 0.0.35 \
 *     --checksums-file checksums.txt --tap ../homebrew-dn
 *
 * Looks for the tap at $HOMEBREW_DN_TAP or ../homebrew-dn relative to the dn
 * repo root. Fetches checksums.txt from the GitHub release unless
 * `--checksums-file` is provided (preferred in CI).
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

interface CliOptions {
  version: string;
  dryRun: boolean;
  tapPath?: string;
  checksumsFile?: string;
}

interface PlatformAsset {
  binary: string;
  sha256: string;
}

const PLATFORMS = [
  "dn-macos-arm64",
  "dn-macos-x64",
  "dn-linux-arm64",
  "dn-linux-x64",
] as const;

type PlatformBinary = typeof PLATFORMS[number];

function showHelp(): void {
  console.log(`bump_homebrew_formula.ts - Update homebrew-dn Formula/dn.rb

Usage:
  deno run -A scripts/bump_homebrew_formula.ts --version <x.y.z> [--dry-run]
  deno run -A scripts/bump_homebrew_formula.ts --version <x.y.z> --tap <path>
  deno run -A scripts/bump_homebrew_formula.ts --version <x.y.z> \\
    --checksums-file checksums.txt

Options:
  --version <x.y.z>         Released dn version (without leading v)
  --tap <path>              Path to homebrew-dn checkout (default: HOMEBREW_DN_TAP or ../homebrew-dn)
  --checksums-file <path>   Use a local checksums.txt instead of fetching the release
  --dry-run                 Print the new formula without writing
  -h, --help                Show this help
`);
}

function parseArgs(args: string[]): CliOptions {
  let version: string | undefined;
  let dryRun = false;
  let tapPath: string | undefined;
  let checksumsFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version") {
      version = args[++i];
      if (!version) throw new Error("--version requires a value");
    } else if (arg === "--tap") {
      tapPath = args[++i];
      if (!tapPath) throw new Error("--tap requires a path");
    } else if (arg === "--checksums-file") {
      checksumsFile = args[++i];
      if (!checksumsFile) throw new Error("--checksums-file requires a path");
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!version) {
    throw new Error("--version is required");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version ${version}; expected x.y.z`);
  }

  return { version, dryRun, tapPath, checksumsFile };
}

function dnRepoRoot(): string {
  return resolve(dirname(fromFileUrl(import.meta.url)), "..");
}

function resolveTapPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  const fromEnv = Deno.env.get("HOMEBREW_DN_TAP");
  if (fromEnv) return resolve(fromEnv);
  return resolve(dnRepoRoot(), "..", "homebrew-dn");
}

function parseChecksumsText(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([a-f0-9]{64})\s+(\S+)$/.exec(trimmed);
    if (!match) {
      throw new Error(`Unrecognized checksums.txt line: ${trimmed}`);
    }
    map.set(match[2], match[1]);
  }
  return map;
}

async function loadChecksums(
  version: string,
  checksumsFile?: string,
): Promise<Map<string, string>> {
  if (checksumsFile) {
    return parseChecksumsText(await Deno.readTextFile(checksumsFile));
  }
  const tag = `v${version}`;
  const url =
    `https://github.com/chesapeakedev/dn/releases/download/${tag}/checksums.txt`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return parseChecksumsText(await response.text());
}

function requirePlatforms(
  checksums: Map<string, string>,
): Record<PlatformBinary, PlatformAsset> {
  const out = {} as Record<PlatformBinary, PlatformAsset>;
  for (const binary of PLATFORMS) {
    const sha256 = checksums.get(binary);
    if (!sha256) {
      throw new Error(`checksums.txt missing entry for ${binary}`);
    }
    out[binary] = { binary, sha256 };
  }
  return out;
}

function renderFormula(
  version: string,
  assets: Record<PlatformBinary, PlatformAsset>,
): string {
  return `# typed: false
# frozen_string_literal: true

class Dn < Formula
  desc "CLI for working systematically alongside coding agents"
  homepage "https://docs.denoise.cloud/dn-cli/installation/"
  version "${version}"
  license "Apache-2.0"

  livecheck do
    url "https://github.com/chesapeakedev/dn/releases/latest"
    strategy :github_latest
  end

  on_macos do
    on_arm do
      url "https://github.com/chesapeakedev/dn/releases/download/v#{version}/dn-macos-arm64",
          using: :nounzip
      sha256 "${assets["dn-macos-arm64"].sha256}"
    end
    on_intel do
      url "https://github.com/chesapeakedev/dn/releases/download/v#{version}/dn-macos-x64",
          using: :nounzip
      sha256 "${assets["dn-macos-x64"].sha256}"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/chesapeakedev/dn/releases/download/v#{version}/dn-linux-arm64",
          using: :nounzip
      sha256 "${assets["dn-linux-arm64"].sha256}"
    end
    on_intel do
      url "https://github.com/chesapeakedev/dn/releases/download/v#{version}/dn-linux-x64",
          using: :nounzip
      sha256 "${assets["dn-linux-x64"].sha256}"
    end
  end

  def install
    binary = if OS.mac?
      Hardware::CPU.arm? ? "dn-macos-arm64" : "dn-macos-x64"
    elsif Hardware::CPU.arm?
      "dn-linux-arm64"
    else
      "dn-linux-x64"
    end

    chmod 0755, binary
    bin.install binary => "dn"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/dn --version")
    assert_match "kickstart", shell_output("#{bin}/dn --help 2>&1")
  end
end
`;
}

async function main(): Promise<void> {
  const options = parseArgs(Deno.args);
  const tapPath = resolveTapPath(options.tapPath);
  const formulaPath = join(tapPath, "Formula", "dn.rb");

  try {
    await Deno.stat(formulaPath);
  } catch {
    throw new Error(
      `Formula not found at ${formulaPath}. Clone chesapeakedev/homebrew-dn beside dn or set HOMEBREW_DN_TAP.`,
    );
  }

  const assets = requirePlatforms(
    await loadChecksums(options.version, options.checksumsFile),
  );
  const formula = renderFormula(options.version, assets);

  if (options.dryRun) {
    console.log(formula);
    console.log(`\nDry run: would write ${formulaPath}`);
    return;
  }

  await Deno.writeTextFile(formulaPath, formula);
  console.log(`Updated ${formulaPath} to dn ${options.version}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
