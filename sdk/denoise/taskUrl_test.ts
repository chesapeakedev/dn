// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals } from "@std/assert";
import { isDenoiseTaskUrl, parseDenoiseTaskUrl } from "./taskUrl.ts";

Deno.test("parseDenoiseTaskUrl accepts production and local hosts", () => {
  const parsed = parseDenoiseTaskUrl(
    "https://denoise.cloud/milestone/m-1/task/t-2",
  );
  assertEquals(parsed?.origin, "https://denoise.cloud");
  assertEquals(parsed?.kind, "milestone");
  assertEquals(parsed?.milestoneId, "m-1");
  assertEquals(parsed?.taskId, "t-2");
  assertEquals(
    isDenoiseTaskUrl("http://localhost:5173/milestone/a/task/b"),
    true,
  );
});

Deno.test("parseDenoiseTaskUrl accepts short and task-id paths", () => {
  const short = parseDenoiseTaskUrl("https://denoise.cloud/t/Ab3cdEfg");
  assertEquals(short?.kind, "short_code");
  assertEquals(short?.shortCode, "Ab3cdEfg");

  const byId = parseDenoiseTaskUrl(
    "https://denoise-qa.exe.xyz/task/394fe235-739a-499e-87de-a025f1878a73",
  );
  assertEquals(byId?.kind, "task_id");
  assertEquals(byId?.taskId, "394fe235-739a-499e-87de-a025f1878a73");
});

Deno.test("parseDenoiseTaskUrl rejects unrelated URLs", () => {
  assertEquals(parseDenoiseTaskUrl("https://github.com/o/r/issues/1"), null);
  assertEquals(
    parseDenoiseTaskUrl("https://evil.com/milestone/a/task/b"),
    null,
  );
  assertEquals(parseDenoiseTaskUrl("https://denoise.cloud/t/not-valid!"), null);
});
