// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { fromFileUrl, resolve } from "@std/path";
import denoConfig from "../deno.json" with { type: "json" };
import {
  DEFAULT_DENOISE_API_URL,
  RunnerApiClient,
  type RunnerPairingDevice,
} from "../sdk/runner/client.ts";
import {
  deleteRunnerCredential,
  loadRunnerConfig,
  loadRunnerCredential,
  registerRunnerRepository,
  saveRunnerCredential,
  setRunnerPaused,
  unregisterRunnerRepository,
} from "../sdk/runner/config.ts";
import {
  detectRunnerCapabilities,
  doctorRunner,
  inspectRunnerRepository,
} from "../sdk/runner/doctor.ts";
import {
  generateRunnerService,
  installRunnerService,
  uninstallRunnerService,
} from "../sdk/runner/service.ts";
import {
  type DenoiseTaskDocument,
  parseRepositorySlug,
  repositoryFromIssueUrl,
  RUNNER_CONFIG_SCHEMA_VERSION,
  RUNNER_PROTOCOL_VERSION,
  type RunnerJobSummary,
} from "../sdk/runner/mod.ts";
import { serveRunner } from "../sdk/runner/worker.ts";
import type { PublishMode } from "../sdk/github/publish.ts";
import { parsePublishMode } from "../sdk/github/publish.ts";

interface CommonRunnerOptions {
  json: boolean;
}

function showRunnerHelp(): void {
  console.log(
    "dn runner - Use this developer machine as Denoise infrastructure\n",
  );
  console.log("Usage:");
  console.log("  dn runner connect <code> [--install] [--name <name>]");
  console.log("  dn runner register [path] [--yes] [--json]");
  console.log("  dn runner unregister <owner/repo> [--json]");
  console.log("  dn runner doctor [--json]");
  console.log("  dn runner status [--json]");
  console.log("  dn runner jobs [--json]");
  console.log(
    "  dn runner kickstart <issue> [--publish <mode>] [--wait] [--json]",
  );
  console.log(
    "  dn runner kickstart --denoise-task <file> [--wait] [--json]",
  );
  console.log("  dn runner pause|resume|disconnect [--json]");
  console.log("  dn runner rotate [--json]");
  console.log("  dn runner install");
  console.log("  dn runner serve [--once]\n");
  console.log(
    "Device jobs use your registered checkout, local agent login, and hardware.",
  );
  console.log(
    "Source code, checkout paths, GitHub credentials, and agent credentials stay on this machine.",
  );
}

function parseCommonOptions(args: string[]): CommonRunnerOptions {
  const unknown = args.filter((argument) => argument !== "--json");
  if (unknown.length > 0) {
    throw new Error(`Unexpected argument: ${unknown[0]}`);
  }
  return { json: args.includes("--json") };
}

function homeDirectory(): string {
  const home = Deno.env.get("HOME")?.trim();
  if (!home) throw new Error("HOME is not set.");
  return home;
}

/** Returns an argv prefix that can invoke this exact dn build. */
export function currentDnCommand(): string[] {
  if (Deno.build.standalone) return [Deno.execPath()];
  try {
    const mainUrl = new URL(Deno.mainModule);
    if (mainUrl.protocol === "file:" && mainUrl.pathname.endsWith(".ts")) {
      return [
        Deno.execPath(),
        "run",
        "--allow-all",
        fromFileUrl(mainUrl),
      ];
    }
  } catch {
    // Compiled binaries expose a non-source main module and use execPath below.
  }
  return [Deno.execPath()];
}

async function openApprovalUrl(url: string): Promise<void> {
  const command = Deno.build.os === "darwin"
    ? ["open", url]
    : Deno.build.os === "linux"
    ? ["xdg-open", url]
    : [];
  if (command.length === 0) return;
  try {
    await new Deno.Command(command[0], {
      args: command.slice(1),
      stdout: "null",
      stderr: "null",
    }).output();
  } catch {
    // The printed URL remains the reliable fallback.
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function handleConnect(args: string[]): Promise<void> {
  let code: string | null = null;
  let name = Deno.hostname();
  let apiUrl = DEFAULT_DENOISE_API_URL;
  let install = false;
  let registerCurrent = false;
  let noOpen = false;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--name") {
      name = args[++index] ?? "";
      if (!name) throw new Error("--name requires a value.");
    } else if (argument === "--api-url") {
      apiUrl = args[++index] ?? "";
      if (!apiUrl) throw new Error("--api-url requires a value.");
    } else if (argument === "--install") {
      install = true;
    } else if (argument === "--repo") {
      registerCurrent = true;
    } else if (argument === "--no-open") {
      noOpen = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!code) {
      code = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  if (!code) throw new Error("Usage: dn runner connect <code> [--install]");
  if (Deno.build.os !== "darwin" && Deno.build.os !== "linux") {
    throw new Error("Device runners require macOS or Linux.");
  }
  if (Deno.uid() === 0) {
    throw new Error("Device runners must run as a logged-in non-root user.");
  }
  const [capabilities, config] = await Promise.all([
    detectRunnerCapabilities(),
    loadRunnerConfig(),
  ]);
  const device: RunnerPairingDevice = {
    display_name: name,
    platform: Deno.build.os,
    architecture: Deno.build.arch,
    dn_version: denoConfig.version,
    protocol_version: RUNNER_PROTOCOL_VERSION,
    capabilities,
    repositories: Object.keys(config.repositories),
  };
  const client = new RunnerApiClient({ apiUrl });
  const pairing = await client.startPairing(code, device);
  if (!json) {
    console.error(`Approve this device in Denoise: ${pairing.approval_url}`);
  }
  if (!noOpen) await openApprovalUrl(pairing.approval_url);

  let exchangeToken: string | undefined;
  while (Date.now() < Date.parse(pairing.expires_at)) {
    const status = await client.getPairingStatus(
      pairing.id,
      pairing.poll_token,
    );
    if (status.state === "approved") {
      exchangeToken = status.exchange_token;
      break;
    }
    if (status.state === "expired" || status.state === "denied") {
      throw new Error(`Pairing was ${status.state}.`);
    }
    await delay(2_000);
  }
  if (!exchangeToken) throw new Error("Pairing approval expired.");
  const exchange = await client.exchangePairing(pairing.id, exchangeToken);
  await saveRunnerCredential({
    schema_version: RUNNER_CONFIG_SCHEMA_VERSION,
    runner_id: exchange.runner.id,
    display_name: exchange.runner.display_name,
    api_url: apiUrl,
    credential: exchange.credential,
    created_at: new Date().toISOString(),
    expires_at: exchange.credential_expires_at,
  });
  if (registerCurrent) await registerCurrentRepository(Deno.cwd(), true);
  if (install) await installCurrentRunnerService();
  const result = {
    paired: true,
    runner: exchange.runner,
    service_installed: install,
    repository_registered: registerCurrent,
  };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(
      `${exchange.runner.display_name} paired and ready for registered repositories.`,
    );
  }
}

async function registerCurrentRepository(
  path: string,
  trusted: boolean,
): Promise<string> {
  const absolutePath = resolve(path);
  const inspected = await inspectRunnerRepository(absolutePath);
  if (!trusted) {
    console.error(
      "Warning: issue-driven agents can execute code from this repository as your logged-in user.",
    );
    console.error(
      "Use the Docker sandbox for untrusted repositories. Local paths and credentials are never uploaded.",
    );
    if (
      !Deno.stdin.isTerminal() || !confirm(
        `Trust ${inspected.repository} at ${absolutePath} for remote Kickstart jobs?`,
      )
    ) {
      throw new Error("Repository registration requires explicit trust.");
    }
  }
  await registerRunnerRepository(inspected.repository, absolutePath);
  return inspected.repository;
}

async function handleRegister(args: string[]): Promise<void> {
  let path = Deno.cwd();
  let trusted = false;
  let json = false;
  for (const argument of args) {
    if (argument === "--yes" || argument === "--trust") trusted = true;
    else if (argument === "--json") json = true;
    else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (path === Deno.cwd()) path = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  const repository = await registerCurrentRepository(path, trusted);
  const result = { registered: true, repository };
  if (json) console.log(JSON.stringify(result));
  else console.log(`${repository} is registered and trusted.`);
}

async function handleUnregister(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const repositoryArgument = args.find((argument) => !argument.startsWith("-"));
  if (!repositoryArgument) {
    throw new Error("Usage: dn runner unregister <owner/repo>");
  }
  const repository = parseRepositorySlug(repositoryArgument);
  await unregisterRunnerRepository(repository);
  if (json) console.log(JSON.stringify({ unregistered: true, repository }));
  else console.log(`${repository} is no longer available to Denoise.`);
}

async function authenticatedClient(): Promise<{
  client: RunnerApiClient;
  runnerId: string;
}> {
  const credential = await loadRunnerCredential();
  if (!credential) {
    throw new Error("Runner is not paired; run dn runner connect <code>.");
  }
  if (Date.parse(credential.expires_at) <= Date.now()) {
    throw new Error(
      "Runner credential has expired; run dn runner connect <code>.",
    );
  }
  return {
    client: new RunnerApiClient({
      apiUrl: credential.api_url,
      credential: credential.credential,
    }),
    runnerId: credential.runner_id,
  };
}

async function handleDoctor(args: string[]): Promise<void> {
  const { json } = parseCommonOptions(args);
  const result = await doctorRunner();
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  for (const check of result.checks) {
    console.log(
      `${check.ok ? "OK" : "ERROR"}  ${check.name}: ${check.message}`,
    );
  }
  for (const repository of result.repositories) {
    console.log(
      `${repository.ready ? "OK" : "ERROR"}  ${repository.repository}: ${
        repository.reason ?? "ready"
      }`,
    );
  }
  if (!result.ok) throw new Error("Runner is not ready.");
}

async function handleStatus(args: string[]): Promise<void> {
  const { json } = parseCommonOptions(args);
  const [{ client }, local, doctor] = await Promise.all([
    authenticatedClient(),
    loadRunnerConfig(),
    doctorRunner(),
  ]);
  const remote = await client.status();
  const result = {
    runner: remote.runner,
    active_job: remote.active_job,
    local: {
      paused: local.paused,
      repositories: doctor.repositories,
      harnesses: doctor.capabilities.harnesses,
      docker: doctor.capabilities.docker,
    },
  };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(
      `${remote.runner.display_name} — ${remote.runner.state}`,
    );
    console.log(
      `${
        doctor.repositories.filter((repository) => repository.ready).length
      } repositories ready; agents: ${
        doctor.capabilities.harnesses.join(", ") || "none"
      }`,
    );
    if (remote.active_job) {
      console.log(
        `Active: ${remote.active_job.repository} ${remote.active_job.operation.type} (${remote.active_job.state})`,
      );
    }
  }
}

async function handleJobs(args: string[]): Promise<void> {
  const { json } = parseCommonOptions(args);
  const { client } = await authenticatedClient();
  const result = await client.jobs();
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.jobs.length === 0) {
    console.log("No recent device-runner jobs.");
    return;
  }
  for (const job of result.jobs) {
    const label = job.operation.type === "denoise-task"
      ? `denoise-task ${job.operation.task_document.title}`
      : job.operation.issue_url;
    console.log(
      `${job.state.padEnd(11)} ${job.repository} ${label}`,
    );
  }
}

function terminalJob(job: RunnerJobSummary): boolean {
  return ["succeeded", "failed", "cancelled", "interrupted"].includes(
    job.state,
  );
}

async function resolveKickstartIssue(
  input: string,
): Promise<{ issueUrl: string; repository: string }> {
  if (/^#?\d+$/.test(input)) {
    const inspected = await inspectRunnerRepository(Deno.cwd());
    const issueNumber = input.replace(/^#/, "");
    return {
      repository: inspected.repository,
      issueUrl:
        `https://github.com/${inspected.repository}/issues/${issueNumber}`,
    };
  }
  return {
    issueUrl: input,
    repository: repositoryFromIssueUrl(input),
  };
}

async function handleKickstart(args: string[]): Promise<void> {
  let issue: string | null = null;
  let denoiseTaskPath: string | null = null;
  let publish: PublishMode = "pr";
  let wait = false;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--publish") {
      const value = args[++index];
      if (!value) throw new Error("--publish requires a value.");
      publish = parsePublishMode(value);
    } else if (argument === "--denoise-task") {
      denoiseTaskPath = args[++index];
      if (!denoiseTaskPath) {
        throw new Error("--denoise-task requires a file path.");
      }
    } else if (argument === "--wait") wait = true;
    else if (argument === "--json") json = true;
    else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!issue) issue = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  if (!issue && !denoiseTaskPath) {
    throw new Error(
      "Usage: dn runner kickstart <issue> | dn runner kickstart --denoise-task <file>",
    );
  }
  if (publish !== "pr") {
    throw new Error(
      "Device runner jobs require --publish pr; none and direct are available only for local CLI execution.",
    );
  }
  const [{ client, runnerId }, config] = await Promise.all([
    authenticatedClient(),
    loadRunnerConfig(),
  ]);

  if (denoiseTaskPath) {
    const jsonText = await Deno.readTextFile(denoiseTaskPath);
    const taskDocument: DenoiseTaskDocument = JSON.parse(jsonText);
    if (!taskDocument.id || !taskDocument.title || !taskDocument.body) {
      throw new Error(
        "Denoise task document must include id, title, and body.",
      );
    }
    const repository = taskDocument.repository ?? undefined;
    if (repository && !config.repositories[repository]) {
      throw new Error(
        `${repository} is not registered; run dn runner register from its checkout.`,
      );
    }
    const queued = await client.denoiseTask({
      runner_id: runnerId,
      repository,
      task_document: taskDocument,
      publish,
    });
    if (!wait) {
      if (json) console.log(JSON.stringify(queued));
      else {
        console.log(
          `Queued denoise-task ${taskDocument.id} on this device until ${queued.expires_at}.`,
        );
      }
      return;
    }
    let completed: RunnerJobSummary | undefined;
    while (!completed) {
      const jobs = await client.jobs();
      const current = jobs.jobs.find((job) =>
        job.invocation_id === queued.invocation_id
      );
      if (current && terminalJob(current)) completed = current;
      else await delay(2_000);
    }
    if (json) console.log(JSON.stringify({ ...queued, job: completed }));
    else {
      console.log(
        `${completed.state}: ${
          completed.pr_url ?? `denoise-task ${taskDocument.id}`
        }`,
      );
    }
    if (completed.state !== "succeeded") {
      throw new Error(`Runner job ${completed.state}.`);
    }
    return;
  }

  const resolved = await resolveKickstartIssue(issue!);
  if (!config.repositories[resolved.repository]) {
    throw new Error(
      `${resolved.repository} is not registered; run dn runner register from its checkout.`,
    );
  }
  const queued = await client.kickstart({
    runner_id: runnerId,
    repository: resolved.repository,
    issue_url: resolved.issueUrl,
    publish,
  });
  if (!wait) {
    if (json) console.log(JSON.stringify(queued));
    else {
      console.log(
        `Queued ${resolved.issueUrl} on this device until ${queued.expires_at}.`,
      );
    }
    return;
  }
  let completed: RunnerJobSummary | undefined;
  while (!completed) {
    const jobs = await client.jobs();
    const current = jobs.jobs.find((job) =>
      job.invocation_id === queued.invocation_id
    );
    if (current && terminalJob(current)) completed = current;
    else await delay(2_000);
  }
  if (json) console.log(JSON.stringify({ ...queued, job: completed }));
  else {
    const opLabel = "issue_url" in completed.operation
      ? completed.operation.issue_url
      : `denoise-task ${completed.operation.task_document.title}`;
    console.log(
      `${completed.state}: ${completed.pr_url ?? opLabel}`,
    );
  }
  if (completed.state !== "succeeded") {
    throw new Error(`Runner job ${completed.state}.`);
  }
}

async function handlePauseState(
  paused: boolean,
  args: string[],
): Promise<void> {
  const { json } = parseCommonOptions(args);
  const { client } = await authenticatedClient();
  await client.setPaused(paused);
  await setRunnerPaused(paused);
  const result = { paused };
  if (json) console.log(JSON.stringify(result));
  else console.log(paused ? "Runner paused." : "Runner resumed.");
}

async function installCurrentRunnerService(): Promise<void> {
  const definition = generateRunnerService(
    [...currentDnCommand(), "runner", "serve"],
    homeDirectory(),
  );
  await installRunnerService(definition);
}

async function handleInstall(args: string[]): Promise<void> {
  const { json } = parseCommonOptions(args);
  if (Deno.uid() === 0) {
    throw new Error("Device runners must run as a logged-in non-root user.");
  }
  await authenticatedClient();
  await installCurrentRunnerService();
  if (json) console.log(JSON.stringify({ installed: true }));
  else console.log("Denoise runner user service installed and started.");
}

async function handleServe(args: string[]): Promise<void> {
  let once = false;
  for (const argument of args) {
    if (argument === "--once") once = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (
    (Deno.build.os === "darwin" || Deno.build.os === "linux") &&
    Deno.uid() === 0
  ) {
    throw new Error("Device runners must run as a logged-in non-root user.");
  }
  const { client, runnerId } = await authenticatedClient();
  await serveRunner({
    runnerId,
    dnVersion: denoConfig.version,
    commandPrefix: currentDnCommand(),
    client,
    once,
  });
}

async function handleDisconnect(args: string[]): Promise<void> {
  const { json } = parseCommonOptions(args);
  const { client } = await authenticatedClient();
  await client.disconnect();
  const definition = generateRunnerService(
    [...currentDnCommand(), "runner", "serve"],
    homeDirectory(),
  );
  let serviceRemoved = true;
  try {
    await uninstallRunnerService(definition);
  } catch {
    serviceRemoved = false;
  }
  await deleteRunnerCredential();
  const result = { disconnected: true, service_removed: serviceRemoved };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(
      serviceRemoved
        ? "Runner revoked and its user service removed."
        : "Runner revoked. Remove its user service manually.",
    );
  }
}

async function handleRotate(args: string[]): Promise<void> {
  const { json } = parseCommonOptions(args);
  const credential = await loadRunnerCredential();
  if (!credential) {
    throw new Error("Runner is not paired; run dn runner connect <code>.");
  }
  const client = new RunnerApiClient({
    apiUrl: credential.api_url,
    credential: credential.credential,
  });
  const rotated = await client.rotateCredential();
  await saveRunnerCredential({
    ...credential,
    credential: rotated.credential,
    created_at: new Date().toISOString(),
    expires_at: rotated.credential_expires_at,
  });
  const result = { rotated: true, expires_at: rotated.credential_expires_at };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(
      `Runner credential rotated; expires ${rotated.credential_expires_at}.`,
    );
  }
}

/** Handles the complete `dn runner` command family. */
export async function handleRunner(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (!subcommand || ["help", "--help", "-h"].includes(subcommand)) {
    showRunnerHelp();
    return;
  }
  switch (subcommand) {
    case "connect":
      await handleConnect(rest);
      break;
    case "register":
      await handleRegister(rest);
      break;
    case "unregister":
      await handleUnregister(rest);
      break;
    case "doctor":
      await handleDoctor(rest);
      break;
    case "status":
      await handleStatus(rest);
      break;
    case "jobs":
      await handleJobs(rest);
      break;
    case "kickstart":
      await handleKickstart(rest);
      break;
    case "pause":
      await handlePauseState(true, rest);
      break;
    case "resume":
      await handlePauseState(false, rest);
      break;
    case "install":
      await handleInstall(rest);
      break;
    case "serve":
      await handleServe(rest);
      break;
    case "disconnect":
      await handleDisconnect(rest);
      break;
    case "rotate":
      await handleRotate(rest);
      break;
    default:
      throw new Error(`Unknown runner subcommand: ${subcommand}`);
  }
}
