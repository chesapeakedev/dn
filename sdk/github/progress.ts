// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Versions supported by the kickstart progress-event contract. */
export type KickstartProgressSchemaVersion = "1.0";

/** Events emitted while a kickstart invocation is running. */
export type KickstartProgressEventType =
  | "invocation.queued"
  | "invocation.running"
  | "step.started"
  | "step.completed"
  | "phase.started"
  | "phase.completed"
  | "lint.completed"
  | "publish.completed"
  | "agent.line"
  | "invocation.succeeded"
  | "invocation.failed";

/** A versioned progress event consumed by denoise. */
export interface KickstartProgressEvent {
  schema_version: KickstartProgressSchemaVersion;
  invocation_id: string;
  seq: number;
  ts: string;
  type: KickstartProgressEventType;
  phase?: "plan" | "implement" | "lint" | "publish";
  step?: number;
  message: string;
  data?: Record<string, unknown>;
}

/** Fields supplied by a workflow when reporting progress. */
export interface ProgressEventInput {
  type: KickstartProgressEventType;
  message: string;
  phase?: KickstartProgressEvent["phase"];
  step?: number;
  data?: Record<string, unknown>;
}

/** Delivers progress events without affecting the workflow result. */
export interface ProgressReporter {
  /** Emits one event. Implementations must not throw for delivery failures. */
  report(input: ProgressEventInput): Promise<void>;
}

/** Identifies the output stream that produced an agent log line. */
export type AgentOutputStream = "stdout" | "stderr";

/** Options for forwarding a child-process output stream to progress reporting. */
export interface AgentStreamOptions {
  /** Kickstart phase running the child process. */
  phase: "plan" | "implement";
  /** Child-process output stream being forwarded. */
  stream: AgentOutputStream;
  /** Whether to emit `agent.line` events; defaults to `DN_PROGRESS_VERBOSE=1`. */
  verbose?: boolean;
  /** Receives the original bytes for the human-facing console. */
  write?: (chunk: Uint8Array) => Promise<unknown>;
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{8,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /glpat-[A-Za-z0-9_-]{8,}/g,
  /(Bearer\s+)[A-Za-z0-9._~-]{8,}/gi,
  /(\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|token)\b\s*[:=]\s*)[^\s'"`]+/gi,
];

/** Replaces recognizable credentials in agent output before it leaves dn. */
export function redactAgentOutput(line: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) =>
      redacted.replace(
        pattern,
        (_match, prefix?: unknown) =>
          typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]",
      ),
    line,
  );
}

/**
 * Copies child-process output to the human console, captures it, and optionally
 * reports complete redacted lines as `agent.line` progress events.
 */
export async function streamAgentOutput(
  input: ReadableStream<Uint8Array>,
  reporter: ProgressReporter,
  options: AgentStreamOptions,
): Promise<string> {
  const verbose = options.verbose ??
    Deno.env.get("DN_PROGRESS_VERBOSE") === "1";
  const decoder = new TextDecoder();
  let output = "";
  let pendingLine = "";

  const reportLine = async (line: string): Promise<void> => {
    if (!verbose || line.length === 0) return;
    await reporter.report({
      type: "agent.line",
      phase: options.phase,
      message: redactAgentOutput(line),
      data: { stream: options.stream },
    });
  };

  for await (const chunk of input) {
    if (options.write) await options.write(chunk);
    const text = decoder.decode(chunk, { stream: true });
    output += text;
    pendingLine += text;
    const lines = pendingLine.split(/\r?\n/);
    pendingLine = lines.pop() ?? "";
    for (const line of lines) await reportLine(line);
  }

  const finalText = decoder.decode();
  output += finalText;
  pendingLine += finalText;
  await reportLine(pendingLine);
  return output;
}

/** A reporter used when progress reporting is not configured. */
export class NullReporter implements ProgressReporter {
  report(_input: ProgressEventInput): Promise<void> {
    return Promise.resolve();
  }
}

abstract class SequencedReporter implements ProgressReporter {
  #sequence = 0;

  constructor(private readonly invocationId: string) {}

  async report(input: ProgressEventInput): Promise<void> {
    const event: KickstartProgressEvent = {
      schema_version: "1.0",
      invocation_id: this.invocationId,
      seq: ++this.#sequence,
      ts: new Date().toISOString(),
      type: input.type,
      message: input.message,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      ...(input.step === undefined ? {} : { step: input.step }),
      ...(input.data === undefined ? {} : { data: input.data }),
    };
    await this.deliver(event);
  }

  protected abstract deliver(event: KickstartProgressEvent): Promise<void>;
}

/** Writes one JSON progress event per line to standard error. */
export class NdjsonReporter extends SequencedReporter {
  protected deliver(event: KickstartProgressEvent): Promise<void> {
    console.error(JSON.stringify(event));
    return Promise.resolve();
  }
}

/** Sends progress events to a denoise HTTP endpoint. */
export class HttpReporter extends SequencedReporter {
  #didLogDeliveryFailure = false;

  constructor(
    invocationId: string,
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    super(invocationId);
  }

  protected async deliver(event: KickstartProgressEvent): Promise<void> {
    try {
      const response = await this.fetchFn(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch {
      if (!this.#didLogDeliveryFailure) {
        this.#didLogDeliveryFailure = true;
        console.error(
          "[dn] Progress delivery failed; continuing without progress updates.",
        );
      }
    }
  }
}

/**
 * Creates the configured progress reporter.
 *
 * Reporting is disabled unless both `DN_DISPATCH_ID` and a supported
 * `DN_PROGRESS` mode are set. HTTP mode additionally requires a URL and token.
 */
export function createProgressReporter(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): ProgressReporter {
  const invocationId = env.DN_DISPATCH_ID?.trim();
  if (!invocationId) return new NullReporter();

  if (env.DN_PROGRESS === "ndjson") return new NdjsonReporter(invocationId);
  if (
    env.DN_PROGRESS === "http" && env.DN_PROGRESS_URL?.trim() &&
    env.DN_PROGRESS_TOKEN?.trim()
  ) {
    return new HttpReporter(
      invocationId,
      env.DN_PROGRESS_URL,
      env.DN_PROGRESS_TOKEN,
    );
  }
  return new NullReporter();
}
