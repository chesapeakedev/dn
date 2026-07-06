// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertStringIncludes } from "@std/assert";
import { ExeDevRunner } from "./exeDevRunner.ts";
import type { ExeDevHttpClient } from "./types.ts";

Deno.test({
  name: "ExeDevRunner.exec honors cwd and env in remote shell command",
  permissions: { env: true },
}, async () => {
  const calls: string[] = [];
  const http: ExeDevHttpClient = {
    exec(_token, command) {
      calls.push(command);
      return Promise.resolve({ status: 200, body: "ok" });
    },
  };
  Deno.env.set("EXE_TOKEN", "exe1.test");
  try {
    const runner = new ExeDevRunner(http);
    await runner.exec(
      { provider: "exe.dev", id: "dn-kickstart-test", workspace: "/workspace" },
      ["opencode", "run", "plan", "-f", "/workspace/.dn/tmp/prompt.txt"],
      {
        cwd: "/workspace",
        env: { DN_IN_SANDBOX: "1", DN_SANDBOX_PROVIDER: "none" },
      },
    );
    const cmd = calls[0];
    assertStringIncludes(cmd, "ssh dn-kickstart-test");
    assertStringIncludes(cmd, "cd '/workspace'");
    assertStringIncludes(cmd, "export DN_IN_SANDBOX='1'");
    assertStringIncludes(cmd, "export DN_SANDBOX_PROVIDER='none'");
    assertStringIncludes(cmd, "'opencode'");
  } finally {
    Deno.env.delete("EXE_TOKEN");
  }
});
