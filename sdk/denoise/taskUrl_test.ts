// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { isDenoiseTaskUrl, parseDenoiseTaskUrl } from "./taskUrl.ts";

Deno.test("parseDenoiseTaskUrl accepts production and local hosts", () => {
  const parsed = parseDenoiseTaskUrl(
    "https://denoise.cloud/milestone/m-1/task/t-2",
  );
  assertEquals(parsed?.origin, "https://denoise.cloud");
  assertEquals(parsed?.milestoneId, "m-1");
  assertEquals(parsed?.taskId, "t-2");
  assertEquals(
    isDenoiseTaskUrl("http://localhost:5173/milestone/a/task/b"),
    true,
  );
});

Deno.test("parseDenoiseTaskUrl rejects unrelated URLs", () => {
  assertEquals(parseDenoiseTaskUrl("https://github.com/o/r/issues/1"), null);
  assertEquals(parseDenoiseTaskUrl("https://evil.com/milestone/a/task/b"), null);
});
