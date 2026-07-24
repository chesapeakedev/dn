// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertStringIncludes } from "@std/assert";
import { generateLaunchdService, generateSystemdService } from "./service.ts";

Deno.test("generateLaunchdService creates a user agent with escaped argv", () => {
  const service = generateLaunchdService(
    ["/Users/alex/My Tools/dn", "runner", "serve", "a&b"],
    "/Users/alex",
  );
  assertEquals(
    service.path,
    "/Users/alex/Library/LaunchAgents/cloud.denoise.runner.plist",
  );
  assertStringIncludes(service.content, "<string>runner</string>");
  assertStringIncludes(service.content, "<string>a&amp;b</string>");
  assertStringIncludes(service.content, "<key>KeepAlive</key>");
  assertStringIncludes(service.content, "<key>PATH</key>");
});

Deno.test("generateSystemdService creates a non-root user service", () => {
  const service = generateSystemdService(
    ["/home/alex/bin/dn", "runner", "serve"],
    "/home/alex",
  );
  assertEquals(
    service.path,
    "/home/alex/.config/systemd/user/denoise-runner.service",
  );
  assertStringIncludes(
    service.content,
    'ExecStart="/home/alex/bin/dn" "runner" "serve"',
  );
  assertStringIncludes(service.content, "NoNewPrivileges=true");
  assertStringIncludes(service.content, 'Environment="PATH=');
});
