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

const TRUSTED_API_HOST_RE = [
  /^denoise\.cloud$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/i,
  /^denoise-qa(?:-[0-9]+)?\.exe\.xyz$/i,
] as const;

function resolveApiBase(apiUrl?: string): string {
  const raw = apiUrl?.trim() || DEFAULT_DENOISE_API_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function assertTrustedDenoiseApiUrl(apiUrl: string): void {
  const base = resolveApiBase(apiUrl);
  let host: string;
  try {
    host = new URL(base.includes("://") ? base : `https://${base}`).hostname
      .split(":")[0];
  } catch {
    throw new Error(`Invalid Denoise API URL: ${apiUrl}`);
  }
  if (!TRUSTED_API_HOST_RE.some((re) => re.test(host))) {
    throw new Error(
      `Untrusted Denoise API host "${host}". Set DN_DENOISE_API_INSECURE=1 to override.`,
    );
  }
}

export function isInsecureDenoiseApiAllowed(): boolean {
  try {
    return Deno.env.get("DN_DENOISE_API_INSECURE") === "1";
  } catch {
    return false;
  }
}

export async function denoiseApiRequest<T = unknown>(
  method: string,
  path: string,
  options: DenoiseApiClientOptions,
  body?: unknown,
): Promise<T> {
  const base = resolveApiBase(options.apiUrl);
  if (!isInsecureDenoiseApiAllowed()) {
    assertTrustedDenoiseApiUrl(base);
  }
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
