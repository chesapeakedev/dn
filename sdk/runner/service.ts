// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, join } from "@std/path";

/** Supported user-service managers for device runners. */
export type RunnerServicePlatform = "darwin" | "linux";

/** Generated user-service file and its installation path. */
export interface RunnerServiceDefinition {
  /** Native service manager targeted by the definition. */
  platform: RunnerServicePlatform;
  /** Absolute user-service installation path. */
  path: string;
  /** Complete native service file contents. */
  content: string;
}

const SERVICE_LABEL = "cloud.denoise.runner";

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function systemdQuote(value: string): string {
  return `"${
    value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll(
      "%",
      "%%",
    )
  }"`;
}

/** Generates a launchd user agent for `dn runner serve`. */
export function generateLaunchdService(
  command: string[],
  homeDirectory: string,
  pathValue: string = Deno.env.get("PATH") ?? "/usr/local/bin:/usr/bin:/bin",
): RunnerServiceDefinition {
  if (command.length === 0) throw new Error("Runner service command is empty.");
  const argumentsXml = command.map((argument) =>
    `      <string>${xmlEscape(argument)}</string>`
  ).join("\n");
  const logDirectory = join(homeDirectory, ".dn", "runner");
  return {
    platform: "darwin",
    path: join(
      homeDirectory,
      "Library",
      "LaunchAgents",
      `${SERVICE_LABEL}.plist`,
    ),
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argumentsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${xmlEscape(pathValue)}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(join(logDirectory, "runner.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(join(logDirectory, "runner.error.log"))}</string>
  </dict>
</plist>
`,
  };
}

/** Generates a systemd user service for `dn runner serve`. */
export function generateSystemdService(
  command: string[],
  homeDirectory: string,
  pathValue: string = Deno.env.get("PATH") ?? "/usr/local/bin:/usr/bin:/bin",
): RunnerServiceDefinition {
  if (command.length === 0) throw new Error("Runner service command is empty.");
  return {
    platform: "linux",
    path: join(
      homeDirectory,
      ".config",
      "systemd",
      "user",
      "denoise-runner.service",
    ),
    content: `[Unit]
Description=Denoise developer device runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${command.map(systemdQuote).join(" ")}
Environment=${systemdQuote(`PATH=${pathValue}`)}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=default.target
`,
  };
}

/** Generates the native user-service definition for the current platform. */
export function generateRunnerService(
  command: string[],
  homeDirectory: string,
  platform: string = Deno.build.os,
): RunnerServiceDefinition {
  if (platform === "darwin") {
    return generateLaunchdService(command, homeDirectory);
  }
  if (platform === "linux") {
    return generateSystemdService(command, homeDirectory);
  }
  throw new Error("Device runner services require macOS or Linux.");
}

async function runServiceCommand(
  command: string,
  args: string[],
  allowFailure = false,
): Promise<void> {
  const output = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success && !allowFailure) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `${command} ${args.join(" ")} failed: ${stderr || output.code}`,
    );
  }
}

/**
 * Installs and starts a launchd or systemd user service.
 *
 * The service runs as the logged-in user and never requests root privileges.
 */
export async function installRunnerService(
  definition: RunnerServiceDefinition,
): Promise<void> {
  await Deno.mkdir(dirname(definition.path), { recursive: true });
  await Deno.writeTextFile(definition.path, definition.content, {
    mode: 0o600,
  });
  if (Deno.build.os !== "windows") {
    await Deno.chmod(definition.path, 0o600);
  }
  if (definition.platform === "darwin") {
    const uid = Deno.uid();
    await runServiceCommand(
      "launchctl",
      ["bootout", `gui/${uid}`, definition.path],
      true,
    );
    await runServiceCommand(
      "launchctl",
      ["bootstrap", `gui/${uid}`, definition.path],
    );
    return;
  }
  await runServiceCommand("systemctl", ["--user", "daemon-reload"]);
  await runServiceCommand(
    "systemctl",
    ["--user", "enable", "--now", "denoise-runner.service"],
  );
}

/** Stops and removes a previously installed device-runner user service. */
export async function uninstallRunnerService(
  definition: RunnerServiceDefinition,
): Promise<void> {
  if (definition.platform === "darwin") {
    await runServiceCommand(
      "launchctl",
      ["bootout", `gui/${Deno.uid()}`, definition.path],
      true,
    );
  } else {
    await runServiceCommand(
      "systemctl",
      ["--user", "disable", "--now", "denoise-runner.service"],
      true,
    );
  }
  try {
    await Deno.remove(definition.path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (definition.platform === "linux") {
    await runServiceCommand("systemctl", ["--user", "daemon-reload"], true);
  }
}
