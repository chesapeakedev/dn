// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { OpenCodeResult } from "./opencode.ts";
import { isAgentTraceEnabled } from "./output.ts";
import {
  NullReporter,
  type ProgressReporter,
  streamAgentOutput,
} from "./progress.ts";

export interface AgentCommandOptions {
  /** When true, reports `invocation.failed` with `error_code: agent_timeout` before rejecting. */
  reportTimeoutFailure?: boolean;
}

/** Runs an agent command while preserving its output and forwarding live lines. */
export async function runAgentCommand(
  command: string,
  args: string[],
  cwd: string,
  phase: "plan" | "implement",
  reporter: ProgressReporter = new NullReporter(),
  timeoutMs?: number,
  timeoutMessage?: string,
  options: AgentCommandOptions = {},
): Promise<OpenCodeResult> {
  const child = new Deno.Command(command, {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const streamLive = isAgentTraceEnabled();
  const output = Promise.all([
    streamAgentOutput(child.stdout, reporter, {
      phase,
      stream: "stdout",
      ...(streamLive
        ? { write: (chunk: Uint8Array) => Deno.stdout.write(chunk) }
        : {}),
    }),
    streamAgentOutput(child.stderr, reporter, {
      phase,
      stream: "stderr",
      ...(streamLive
        ? { write: (chunk: Uint8Array) => Deno.stderr.write(chunk) }
        : {}),
    }),
  ]);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = timeoutMs === undefined
    ? undefined
    : new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // The child may have exited while the timer fired.
        }
        const message = timeoutMessage ??
          `Agent ${phase} phase timed out after ${
            Math.round(timeoutMs / 1000)
          }s.`;
        if (options.reportTimeoutFailure !== false) {
          void reporter.report({
            type: "invocation.failed",
            phase,
            message,
            data: {
              error_code: "agent_timeout",
              timeout_ms: timeoutMs,
            },
          });
        }
        reject(new Error(message));
      }, timeoutMs);
    });

  try {
    const result = await (timeout === undefined
      ? Promise.all([child.status, output])
      : Promise.race([Promise.all([child.status, output]), timeout]));
    const [status, [stdout, stderr]] = result;
    return { code: status.code, stdout, stderr };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
