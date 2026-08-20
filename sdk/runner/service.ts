// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { dirname, join } from "@std/path";

/** Supported user-service managers for device runners. */
export type RunnerServicePlatform = "darwin" | "linux";

/** Supervisor that owns a device-runner serve loop. */
export type RunnerServiceSupervisor = "launchd" | "systemd" | "none";

/** Generated user-service file and its installation path. */
export interface RunnerServiceDefinition {
  /** Native service manager targeted by the definition. */
  platform: RunnerServicePlatform;
  /** Absolute user-service installation path. */
  path: string;
  /** Complete native service file contents. */
  content: string;
}

/** Local launchd or systemd status for the device-runner serve loop. */
export interface RunnerServiceStatus {
  /** Whether the user-service unit file exists. */
  installed: boolean;
  /** Whether the supervisor reports the serve loop as running. */
  running: boolean;
  /** Native supervisor, or none when the platform has no user service. */
  supervisor: RunnerServiceSupervisor;
  /** Absolute unit-file path, even when the file is missing. */
  path: string;
  /** Supervisor-reported process id when the loop is running. */
  pid?: number;
  /** ProgramArguments or ExecStart parsed from the unit file when present. */
  command?: string[];
}

/** Injectable command and filesystem probe used by service inspection tests. */
export interface RunnerServiceCommandProbe {
  /** Runs one supervisor query command and captures its result. */
  run(
    command: string,
    args: string[],
  ): Promise<{ success: boolean; stdout: string; stderr: string }>;
  /** Returns whether a unit file exists at the given path. */
  exists(path: string): Promise<boolean>;
  /** Reads a unit file for argv comparison. */
  readText(path: string): Promise<string>;
}

/** Options for {@link inspectRunnerService}. */
export interface InspectRunnerServiceOptions {
  /** Command and filesystem probe; defaults to the live supervisor tools. */
  probe?: RunnerServiceCommandProbe;
  /** User id for the launchd `gui/<uid>` domain. */
  uid?: number | null;
}

/** Launchd label for the device-runner user agent. */
export const RUNNER_SERVICE_LABEL = "cloud.denoise.runner";

/** systemd user unit name for the device-runner service. */
export const RUNNER_SYSTEMD_UNIT = "denoise-runner.service";

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
      `${RUNNER_SERVICE_LABEL}.plist`,
    ),
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${RUNNER_SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argumentsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${xmlEscape(homeDirectory)}</string>
      <key>DN_RUNNER_SERVICE</key>
      <string>1</string>
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
      RUNNER_SYSTEMD_UNIT,
    ),
    content: `[Unit]
Description=Denoise developer device runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${command.map(systemdQuote).join(" ")}
Environment=${systemdQuote(`HOME=${homeDirectory}`)}
Environment="DN_RUNNER_SERVICE=1"
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

function xmlUnescape(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll(
    "&quot;",
    '"',
  ).replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

const defaultServiceProbe: RunnerServiceCommandProbe = {
  async run(command, args) {
    try {
      const output = await new Deno.Command(command, {
        args,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        success: output.success,
        stdout: new TextDecoder().decode(output.stdout).trim(),
        stderr: new TextDecoder().decode(output.stderr).trim(),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { success: false, stdout: "", stderr: "command not found" };
      }
      throw error;
    }
  },
  async exists(path) {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  },
  readText(path) {
    return Deno.readTextFile(path);
  },
};

/** Parses `launchctl print` output for running state and pid. */
export function parseLaunchctlPrint(
  stdout: string,
): { running: boolean; pid?: number } {
  const running = /^\s*state = running\s*$/m.test(stdout);
  const pidMatch = stdout.match(/^\s*pid = (\d+)\s*$/m);
  const pid = pidMatch ? Number(pidMatch[1]) : undefined;
  if (!running || pid === undefined || pid <= 0) {
    return { running };
  }
  return { running: true, pid };
}

/** Parses `systemctl show` ActiveState/MainPID output. */
export function parseSystemdShow(
  stdout: string,
): { running: boolean; pid?: number } {
  const active = /^\s*ActiveState=active\s*$/m.test(stdout);
  const pidMatch = stdout.match(/^\s*MainPID=(\d+)\s*$/m);
  const pid = pidMatch ? Number(pidMatch[1]) : undefined;
  if (!active) return { running: false };
  if (pid === undefined || pid <= 0) return { running: true };
  return { running: true, pid };
}

/** Reads ProgramArguments from a generated launchd plist. */
export function parseLaunchdProgramArguments(
  plist: string,
): string[] | undefined {
  const block = plist.match(
    /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!block) return undefined;
  const values = [...block[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map(
    (match) => xmlUnescape(match[1]),
  );
  return values.length > 0 ? values : undefined;
}

/** Reads ExecStart argv from a generated systemd user unit. */
export function parseSystemdExecStart(unit: string): string[] | undefined {
  const line = unit.split("\n").find((entry) => entry.startsWith("ExecStart="));
  if (!line) return undefined;
  const values = [
    ...line.slice("ExecStart=".length).matchAll(/"((?:\\.|[^"\\])*)"/g),
  ].map((match) =>
    match[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\").replaceAll(
      "%%",
      "%",
    )
  );
  return values.length > 0 ? values : undefined;
}

/** Returns whether two service argv lists are identical. */
export function runnerServiceCommandsEqual(
  left: string[],
  right: string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

/**
 * Reports whether the launchd or systemd user service is installed and running.
 *
 * Inspection is read-only. A missing supervisor tool is treated as not running.
 */
export async function inspectRunnerService(
  definition: RunnerServiceDefinition,
  options: InspectRunnerServiceOptions = {},
): Promise<RunnerServiceStatus> {
  const probe = options.probe ?? defaultServiceProbe;
  const supervisor: RunnerServiceSupervisor = definition.platform === "darwin"
    ? "launchd"
    : "systemd";
  const installed = await probe.exists(definition.path);
  let command: string[] | undefined;
  if (installed) {
    try {
      const contents = await probe.readText(definition.path);
      command = supervisor === "launchd"
        ? parseLaunchdProgramArguments(contents)
        : parseSystemdExecStart(contents);
    } catch {
      // Unit file presence still counts as installed even when argv cannot be read.
    }
  }
  const queried = supervisor === "launchd"
    ? await probe.run("launchctl", [
      "print",
      `gui/${options.uid ?? Deno.uid()}/${RUNNER_SERVICE_LABEL}`,
    ])
    : await probe.run("systemctl", [
      "--user",
      "show",
      RUNNER_SYSTEMD_UNIT,
      "--property=ActiveState",
      "--property=MainPID",
    ]);
  const parsed = supervisor === "launchd"
    ? parseLaunchctlPrint(queried.stdout)
    : parseSystemdShow(queried.stdout);
  const running = queried.success && parsed.running;
  return {
    installed,
    running,
    supervisor,
    path: definition.path,
    ...(running && parsed.pid !== undefined ? { pid: parsed.pid } : {}),
    ...(command ? { command } : {}),
  };
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
    ["--user", "enable", "--now", RUNNER_SYSTEMD_UNIT],
  );
}

/**
 * Starts a previously installed device-runner user service without rewriting it.
 *
 * Callers should install the service when the unit file is missing.
 */
export async function startRunnerService(
  definition: RunnerServiceDefinition,
): Promise<void> {
  try {
    await Deno.stat(definition.path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Runner user service is not installed at ${definition.path}.`,
      );
    }
    throw error;
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
    ["--user", "start", RUNNER_SYSTEMD_UNIT],
  );
}

/**
 * Stops a previously installed device-runner user service without removing it.
 *
 * Use this before rotating or replacing a runner credential so an already-running
 * serve loop cannot keep heartbeating with a value the server is about to revoke.
 */
export async function stopRunnerService(
  definition: RunnerServiceDefinition,
): Promise<void> {
  if (definition.platform === "darwin") {
    await runServiceCommand(
      "launchctl",
      ["bootout", `gui/${Deno.uid()}`, definition.path],
      true,
    );
    return;
  }
  await runServiceCommand(
    "systemctl",
    ["--user", "stop", RUNNER_SYSTEMD_UNIT],
    true,
  );
}

/** Stops and removes a previously installed device-runner user service. */
export async function uninstallRunnerService(
  definition: RunnerServiceDefinition,
): Promise<void> {
  await stopRunnerService(definition);
  try {
    await Deno.remove(definition.path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (definition.platform === "linux") {
    await runServiceCommand(
      "systemctl",
      ["--user", "disable", RUNNER_SYSTEMD_UNIT],
      true,
    );
    await runServiceCommand("systemctl", ["--user", "daemon-reload"], true);
  }
}
