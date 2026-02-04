// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * dn auth - Browser-based GitHub authentication (device flow).
 * Caches the token for use by kickstart, glance, etc.
 */

import { runDeviceFlow } from "../sdk/github/deviceFlow.ts";

const CLIENT_ID_ENV = "DN_GITHUB_DEVICE_CLIENT_ID";
const FALLBACK_CLIENT_ID_ENV = "GITHUB_DEVICE_CLIENT_ID";

function getClientId(): string | null {
  return Deno.env.get(CLIENT_ID_ENV) ??
    Deno.env.get(FALLBACK_CLIENT_ID_ENV) ??
    null;
}

export function showAuthHelp(): void {
  console.error("dn auth - Sign in to GitHub in the browser\n");
  console.error("Usage: dn auth\n");
  console.error(
    "Opens your browser to GitHub so you can authorize dn. The token is cached",
  );
  console.error(
    "and used by dn kickstart, glance, etc. You only need to run this once (or",
  );
  console.error("when the cached token expires).\n");
  console.error(
    `For device flow to work, set ${CLIENT_ID_ENV} (or ${FALLBACK_CLIENT_ID_ENV})`,
  );
  console.error(
    "to your GitHub OAuth App client ID. Create an OAuth App at",
  );
  console.error(
    "https://github.com/settings/developers and enable Device flow in its settings.",
  );
}

export async function handleAuth(_args: string[]): Promise<void> {
  const clientId = getClientId();
  if (!clientId || clientId.trim().length === 0) {
    console.error(
      "Device flow requires a GitHub OAuth App client ID.\n" +
        `Set ${CLIENT_ID_ENV} (or ${FALLBACK_CLIENT_ID_ENV}) to your app's client ID.\n` +
        "Create an OAuth App at https://github.com/settings/developers and enable Device flow.",
    );
    Deno.exit(1);
  }

  try {
    await runDeviceFlow({ clientId: clientId.trim() });
    console.error("Successfully signed in. Token cached for future runs.");
  } catch (e) {
    console.error("Authentication failed:", (e as Error).message);
    Deno.exit(1);
  }
}
