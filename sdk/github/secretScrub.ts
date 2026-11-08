// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/** Result of scrubbing a string for likely secrets before agent prompts or storage. */
export interface SecretScrubResult {
  text: string;
  redactionCount: number;
  categories: string[];
}

const RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "github_pat", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { id: "github_pat_classic", pattern: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { id: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    id: "stripe_secret",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  },
  {
    id: "openai_key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "private_key_pem",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    id: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
  },
  {
    id: "slack_token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
];

const PLACEHOLDER = "[REDACTED]";

/**
 * Replaces likely secret material with a neutral placeholder.
 * Pattern-only; does not verify credentials or call third parties.
 */
export function scrubSecrets(text: string): SecretScrubResult {
  let redactionCount = 0;
  const categories = new Set<string>();
  let out = text;
  for (const rule of RULES) {
    const before = out;
    out = out.replace(rule.pattern, () => {
      redactionCount++;
      categories.add(rule.id);
      return PLACEHOLDER;
    });
    if (out !== before) {
      categories.add(rule.id);
    }
  }
  return {
    text: out,
    redactionCount,
    categories: [...categories].sort(),
  };
}
