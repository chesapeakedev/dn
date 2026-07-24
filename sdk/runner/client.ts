// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type {
  RunnerCapabilities,
  RunnerCredentialRotation,
  RunnerHeartbeat,
  RunnerJob,
  RunnerJobCompletion,
  RunnerJobFailure,
  RunnerJobsResponse,
  RunnerKickstartRequest,
  RunnerKickstartResponse,
  RunnerLeaseResponse,
  RunnerPairingExchange,
  RunnerPairingRequest,
  RunnerPairingStatus,
  RunnerProgressEvent,
  RunnerStatusResponse,
} from "./types.ts";

/** Production Denoise API used unless `--api-url` overrides it. */
export const DEFAULT_DENOISE_API_URL = "https://denoise.cloud";

/** Device metadata submitted before a runner credential exists. */
export interface RunnerPairingDevice {
  /** Owner-facing name suggested by the CLI. */
  display_name: string;
  /** Supported operating system. */
  platform: "darwin" | "linux";
  /** Architecture reported by Deno. */
  architecture: string;
  /** Installed dn version. */
  dn_version: string;
  /** Runner protocol requested during pairing. */
  protocol_version: "1.0";
  /** Capabilities detected before pairing. */
  capabilities: RunnerCapabilities;
  /** Previously trusted repository slugs, without paths. */
  repositories: string[];
}

/** Constructor options for the authenticated runner API client. */
export interface RunnerApiClientOptions {
  /** HTTPS Denoise API origin. */
  apiUrl: string;
  /** Runner-scoped credential for authenticated routes. */
  credential?: string;
  /** Optional fetch implementation for embedding and tests. */
  fetch?: typeof fetch;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
  minimum_protocol_version?: string;
}

/**
 * HTTPS client for the outbound-only Denoise device-runner protocol.
 *
 * The client sends only runner-scoped credentials. It never reads or transmits
 * GitHub, model-provider, or local agent credentials.
 */
export class RunnerApiClient {
  readonly #baseUrl: URL;
  readonly #credential?: string;
  readonly #fetch: typeof fetch;

  /** Creates a client for one Denoise origin and optional paired runner. */
  constructor(options: RunnerApiClientOptions) {
    this.#baseUrl = new URL(options.apiUrl);
    const localHttp = this.#baseUrl.protocol === "http:" &&
      (this.#baseUrl.hostname === "localhost" ||
        this.#baseUrl.hostname === "127.0.0.1");
    if (
      this.#baseUrl.protocol !== "https:" &&
      !localHttp
    ) {
      throw new Error("Runner API URL must use HTTPS.");
    }
    if (
      this.#baseUrl.username || this.#baseUrl.password ||
      this.#baseUrl.search || this.#baseUrl.hash ||
      this.#baseUrl.pathname !== "/"
    ) {
      throw new Error("Runner API URL must be an origin without credentials.");
    }
    this.#credential = options.credential;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { authenticated?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const authenticated = options.authenticated ?? true;
    if (authenticated && !this.#credential) {
      throw new Error("Runner is not paired.");
    }
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (authenticated) {
      headers.set("Authorization", `Bearer ${this.#credential}`);
    }
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      let details: ApiErrorBody = {};
      try {
        details = await response.json() as ApiErrorBody;
      } catch {
        // The status below remains actionable when a proxy returns plain text.
      }
      const protocolHint = details.minimum_protocol_version
        ? ` Minimum protocol: ${details.minimum_protocol_version}.`
        : "";
      const message = details.error ?? details.message ??
        `Denoise runner API returned HTTP ${response.status}.`;
      throw new Error(`${message}${protocolHint}`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  /** Creates a short-lived pairing request that requires browser approval. */
  startPairing(
    code: string,
    device: RunnerPairingDevice,
  ): Promise<RunnerPairingRequest> {
    return this.#request(
      "POST",
      "/api/runners/pairings",
      { code, device },
      { authenticated: false },
    );
  }

  /** Polls one pairing request without using a runner credential. */
  getPairingStatus(
    pairingId: string,
    pollToken: string,
  ): Promise<RunnerPairingStatus> {
    return this.#request(
      "POST",
      `/api/runners/pairings/${encodeURIComponent(pairingId)}/status`,
      { poll_token: pollToken },
      { authenticated: false },
    );
  }

  /** Exchanges a browser-approved request for a one-time runner credential. */
  exchangePairing(
    pairingId: string,
    exchangeToken: string,
  ): Promise<RunnerPairingExchange> {
    return this.#request(
      "POST",
      `/api/runners/pairings/${encodeURIComponent(pairingId)}/exchange`,
      { exchange_token: exchangeToken },
      { authenticated: false },
    );
  }

  /** Reports runner and repository readiness. */
  heartbeat(heartbeat: RunnerHeartbeat): Promise<void> {
    return this.#request("POST", "/api/runners/heartbeat", heartbeat);
  }

  /** Long-polls for one atomically claimed job. */
  claimJob(
    waitSeconds = 25,
    signal?: AbortSignal,
  ): Promise<{ job: RunnerJob | null }> {
    return this.#request(
      "POST",
      "/api/runners/jobs/claim",
      { wait_seconds: waitSeconds },
      { signal },
    );
  }

  /** Renews the lease on a running job and receives cancellation state. */
  renewLease(jobId: string, leaseId: string): Promise<RunnerLeaseResponse> {
    return this.#request(
      "POST",
      `/api/runners/jobs/${encodeURIComponent(jobId)}/lease`,
      { lease_id: leaseId },
    );
  }

  /** Forwards one already-redacted NDJSON progress event. */
  sendProgress(jobId: string, event: RunnerProgressEvent): Promise<void> {
    return this.#request(
      "POST",
      `/api/runners/jobs/${encodeURIComponent(jobId)}/progress`,
      { event },
    );
  }

  /** Marks a claimed job complete. */
  completeJob(
    jobId: string,
    completion: RunnerJobCompletion,
  ): Promise<void> {
    return this.#request(
      "POST",
      `/api/runners/jobs/${encodeURIComponent(jobId)}/complete`,
      completion,
    );
  }

  /** Marks a claimed job failed, cancelled, or interrupted. */
  failJob(jobId: string, failure: RunnerJobFailure): Promise<void> {
    return this.#request(
      "POST",
      `/api/runners/jobs/${encodeURIComponent(jobId)}/fail`,
      failure,
    );
  }

  /** Returns owner-visible runner status. */
  status(): Promise<RunnerStatusResponse> {
    return this.#request("GET", "/api/runners/status");
  }

  /** Returns owner-visible recent jobs. */
  jobs(): Promise<RunnerJobsResponse> {
    return this.#request("GET", "/api/runners/jobs");
  }

  /** Queues a typed Kickstart job for this runner. */
  kickstart(
    request: RunnerKickstartRequest,
  ): Promise<RunnerKickstartResponse> {
    return this.#request("POST", "/api/runners/kickstart", request);
  }

  /** Pauses or resumes remote dispatch to this runner. */
  setPaused(paused: boolean): Promise<void> {
    return this.#request(
      "POST",
      paused ? "/api/runners/pause" : "/api/runners/resume",
    );
  }

  /** Immediately revokes the runner credential server-side. */
  disconnect(): Promise<void> {
    return this.#request("POST", "/api/runners/disconnect");
  }

  /** Rotates the runner-scoped credential and invalidates the previous value. */
  rotateCredential(): Promise<RunnerCredentialRotation> {
    return this.#request("POST", "/api/runners/credential/rotate");
  }
}
