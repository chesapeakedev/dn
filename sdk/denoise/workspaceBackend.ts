// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { DnConfigLayer } from "../config/types.ts";
import { parseDenoiseTaskUrl } from "./taskUrl.ts";

export type WorkspaceBackend = "todo" | "github" | "denoise";

const BACKEND_ENV = "DN_TASK_BACKEND";
const LEGACY_ENV = "DN_WORKSPACE_BACKEND";

export function parseWorkspaceBackendFlag(
  value: string,
): WorkspaceBackend | null {
  const v = value.trim().toLowerCase();
  if (v === "todo" || v === "local") return "todo";
  if (v === "github" || v === "gh") return "github";
  if (v === "denoise" || v === "cloud" || v === "workspace") return "denoise";
  return null;
}

export function inferWorkspaceBackendFromRef(
  ref: string,
): WorkspaceBackend | null {
  const trimmed = ref.trim();
  if (
    /^https?:\/\//i.test(trimmed) &&
    parseDenoiseTaskUrl(trimmed) != null
  ) {
    return "denoise";
  }
  if (/^#?\d+$/.test(trimmed)) return "github";
  if (/github\.com\/.*\/issues\//i.test(trimmed)) return "github";
  return null;
}

export function resolveWorkspaceBackend(options: {
  explicit?: WorkspaceBackend | null;
  config?: DnConfigLayer | null;
  ref?: string;
}): WorkspaceBackend {
  if (options.explicit) return options.explicit;

  const envRaw = Deno.env.get(BACKEND_ENV)?.trim() ||
    Deno.env.get(LEGACY_ENV)?.trim();
  if (envRaw) {
    const parsed = parseWorkspaceBackendFlag(envRaw);
    if (parsed) return parsed;
  }

  const fromConfig = options.config?.workspace?.default_backend;
  if (fromConfig) return fromConfig;

  const legacy = options.config?.tasks?.default_backend;
  if (legacy) return legacy;

  if (options.ref) {
    const inferred = inferWorkspaceBackendFromRef(options.ref);
    if (inferred) return inferred;
  }

  return "todo";
}

export interface ParsedWorkspaceFlags {
  backend: WorkspaceBackend | null;
  apiUrl: string | null;
  args: string[];
}

/**
 * Strips workspace backend flags from argv.
 */
export function parseWorkspaceFlags(args: string[]): ParsedWorkspaceFlags {
  let backend: WorkspaceBackend | null = null;
  let apiUrl: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--todo" || arg === "--local") {
      backend = "todo";
      continue;
    }
    if (arg === "--github" || arg === "--gh") {
      backend = "github";
      continue;
    }
    if (arg === "--denoise" || arg === "--cloud") {
      backend = "denoise";
      continue;
    }
    if (arg === "--backend" && i + 1 < args.length) {
      const parsed = parseWorkspaceBackendFlag(args[++i]);
      if (!parsed) {
        throw new Error(`Invalid --backend value: ${args[i]}`);
      }
      backend = parsed;
      continue;
    }
    if (arg === "--api-url" && i + 1 < args.length) {
      apiUrl = args[++i];
      continue;
    }
    rest.push(arg);
  }

  return { backend, apiUrl, args: rest };
}
