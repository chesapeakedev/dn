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
