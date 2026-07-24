// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type {
  DnSandboxConfig,
  DockerSandboxConfig,
  ExeDevSandboxConfig,
  SandboxMount,
  SandboxProvider,
  SandboxSyncConfig,
  SandboxSyncMode,
} from "./types.ts";

/** Default sandbox block when config omits fields. */
export const DEFAULT_SANDBOX_CONFIG: DnSandboxConfig = {
  provider: "none",
  workspace: "/workspace",
  sync: {
    mode: "bind",
    exclude: [".git", "node_modules", ".sl"],
  },
  docker: {
    image: "ghcr.io/chesapeakedev/dn:opencode",
    network: "none",
    read_only_root: true,
    mounts: [{ source: ".", target: "/workspace" }],
    env_pass_through: [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "CURSOR_API_KEY",
      "COPILOT_GITHUB_TOKEN",
    ],
  },
  exe_dev: {
    image: "exeuntu",
    vm_name_prefix: "dn-kickstart",
    ttl: "4h",
    integrations: ["github"],
  },
};

const SANDBOX_PROVIDERS: readonly SandboxProvider[] = [
  "none",
  "docker",
  "exe.dev",
];

const SYNC_MODES: readonly SandboxSyncMode[] = ["bind", "git_clone"];

/**
 * Parses a sandbox provider string from CLI, env, or config.
 */
export function parseSandboxProvider(value: string): SandboxProvider {
  const normalized = value.trim();
  if (!SANDBOX_PROVIDERS.includes(normalized as SandboxProvider)) {
    throw new Error(
      `Invalid sandbox provider "${value}". Expected one of: ${
        SANDBOX_PROVIDERS.join(", ")
      }`,
    );
  }
  return normalized as SandboxProvider;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`sandbox.${field} must be an array of strings`);
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`sandbox.${field} must be an array of strings`);
    }
  }
  return value;
}

function parseMounts(value: unknown): SandboxMount[] {
  if (!Array.isArray(value)) {
    throw new Error("sandbox.docker.mounts must be an array");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`sandbox.docker.mounts[${index}] must be an object`);
    }
    const mount = entry as Record<string, unknown>;
    if (typeof mount.source !== "string" || typeof mount.target !== "string") {
      throw new Error(
        `sandbox.docker.mounts[${index}] requires string source and target`,
      );
    }
    return { source: mount.source, target: mount.target };
  });
}

function parseSync(value: unknown): SandboxSyncConfig {
  const sync =
    (typeof value === "object" && value !== null ? value : {}) as Record<
      string,
      unknown
    >;
  const modeRaw = sync.mode ?? DEFAULT_SANDBOX_CONFIG.sync.mode;
  if (
    typeof modeRaw !== "string" ||
    !SYNC_MODES.includes(modeRaw as SandboxSyncMode)
  ) {
    throw new Error(
      `sandbox.sync.mode must be one of: ${SYNC_MODES.join(", ")}`,
    );
  }
  const exclude = sync.exclude === undefined
    ? [...DEFAULT_SANDBOX_CONFIG.sync.exclude]
    : parseStringArray(sync.exclude, "sync.exclude");
  return { mode: modeRaw as SandboxSyncMode, exclude };
}

function parseDocker(value: unknown): DockerSandboxConfig {
  const docker =
    (typeof value === "object" && value !== null ? value : {}) as Record<
      string,
      unknown
    >;
  const network = docker.network ?? DEFAULT_SANDBOX_CONFIG.docker.network;
  if (network !== "none" && network !== "bridge") {
    throw new Error('sandbox.docker.network must be "none" or "bridge"');
  }
  const image = typeof docker.image === "string"
    ? docker.image
    : DEFAULT_SANDBOX_CONFIG.docker.image;
  let dockerfile: string | undefined;
  if (docker.dockerfile !== undefined) {
    if (
      typeof docker.dockerfile !== "string" || docker.dockerfile.trim() === ""
    ) {
      throw new Error(
        "sandbox.docker.dockerfile must be a non-empty string path",
      );
    }
    dockerfile = docker.dockerfile;
  }
  const readOnlyRoot = docker.read_only_root === undefined
    ? DEFAULT_SANDBOX_CONFIG.docker.read_only_root
    : Boolean(docker.read_only_root);
  const mounts = docker.mounts === undefined
    ? DEFAULT_SANDBOX_CONFIG.docker.mounts.map((mount) => ({ ...mount }))
    : parseMounts(docker.mounts);
  const envPassThrough = docker.env_pass_through === undefined
    ? [...DEFAULT_SANDBOX_CONFIG.docker.env_pass_through]
    : parseStringArray(docker.env_pass_through, "docker.env_pass_through");
  return {
    image,
    ...(dockerfile !== undefined ? { dockerfile } : {}),
    network,
    read_only_root: readOnlyRoot,
    mounts,
    env_pass_through: envPassThrough,
  };
}

function parseExeDev(value: unknown): ExeDevSandboxConfig {
  const exeDev =
    (typeof value === "object" && value !== null ? value : {}) as Record<
      string,
      unknown
    >;
  return {
    image: typeof exeDev.image === "string"
      ? exeDev.image
      : DEFAULT_SANDBOX_CONFIG.exe_dev.image,
    vm_name_prefix: typeof exeDev.vm_name_prefix === "string"
      ? exeDev.vm_name_prefix
      : DEFAULT_SANDBOX_CONFIG.exe_dev.vm_name_prefix,
    ttl: typeof exeDev.ttl === "string"
      ? exeDev.ttl
      : DEFAULT_SANDBOX_CONFIG.exe_dev.ttl,
    integrations: exeDev.integrations === undefined
      ? [...DEFAULT_SANDBOX_CONFIG.exe_dev.integrations]
      : parseStringArray(exeDev.integrations, "exe_dev.integrations"),
  };
}

/**
 * Parses and validates the `sandbox` block from config.json.
 *
 * Unknown keys at the top level are ignored for forward compatibility.
 */
export function parseDnSandboxConfig(value: unknown): DnSandboxConfig {
  if (value === undefined || value === null) {
    return {
      ...DEFAULT_SANDBOX_CONFIG,
      sync: {
        ...DEFAULT_SANDBOX_CONFIG.sync,
        exclude: [...DEFAULT_SANDBOX_CONFIG.sync.exclude],
      },
      docker: {
        ...DEFAULT_SANDBOX_CONFIG.docker,
        mounts: DEFAULT_SANDBOX_CONFIG.docker.mounts.map((mount) => ({
          ...mount,
        })),
        env_pass_through: [...DEFAULT_SANDBOX_CONFIG.docker.env_pass_through],
      },
      exe_dev: {
        ...DEFAULT_SANDBOX_CONFIG.exe_dev,
        integrations: [...DEFAULT_SANDBOX_CONFIG.exe_dev.integrations],
      },
    };
  }
  if (typeof value !== "object") {
    throw new Error("sandbox must be an object");
  }
  const sandbox = value as Record<string, unknown>;
  const providerRaw = sandbox.provider ?? DEFAULT_SANDBOX_CONFIG.provider;
  if (typeof providerRaw !== "string") {
    throw new Error("sandbox.provider must be a string");
  }
  const provider = parseSandboxProvider(providerRaw);
  const workspace = typeof sandbox.workspace === "string"
    ? sandbox.workspace
    : DEFAULT_SANDBOX_CONFIG.workspace;
  return {
    provider,
    workspace,
    sync: parseSync(sandbox.sync),
    docker: parseDocker(sandbox.docker),
    exe_dev: parseExeDev(sandbox.exe_dev),
  };
}

/**
 * Returns a copy of the sandbox config with an overridden provider.
 */
export function withSandboxProvider(
  config: DnSandboxConfig,
  provider: SandboxProvider,
): DnSandboxConfig {
  return { ...config, provider };
}
