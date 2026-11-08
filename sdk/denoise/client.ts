// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_DENOISE_API_URL } from "../runner/client.ts";

export interface DenoiseApiClientOptions {
  apiUrl?: string;
  githubToken: string;
  fetch?: typeof fetch;
}

export class DenoiseApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DenoiseApiError";
    this.status = status;
  }
}

function resolveApiBase(apiUrl?: string): string {
  const raw = apiUrl?.trim() || DEFAULT_DENOISE_API_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export async function denoiseApiRequest<T = unknown>(
  method: string,
  path: string,
  options: DenoiseApiClientOptions,
  body?: unknown,
): Promise<T> {
  const base = resolveApiBase(options.apiUrl);
  const url = new URL(path, `${base}/`);
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${options.githubToken}`,
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetchImpl(url, { method, headers, body: payload });
  const text = await res.text();
  let parsed: { error?: string } = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as { error?: string };
    } catch {
      parsed = {};
    }
  }
  if (!res.ok) {
    throw new DenoiseApiError(
      parsed.error ?? `Denoise API ${method} ${path} failed (${res.status})`,
      res.status,
    );
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}
