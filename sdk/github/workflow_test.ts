// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import { assertEquals, assertRejects } from "@std/assert";
import {
  dispatchWorkflow,
  parseWorkflowFields,
  resolveWorkflow,
  workflowBase,
} from "./workflow.ts";
import type { WorkflowSummary } from "./workflow.ts";

const OWNER = "acme";
const REPO = "platform";

function activeWorkflow(
  overrides:
    & Partial<WorkflowSummary>
    & Pick<WorkflowSummary, "id" | "name" | "path">,
): WorkflowSummary {
  return {
    state: "active",
    ...overrides,
  };
}

function withStubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  Deno.env.set("GITHUB_TOKEN", "test-token");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init);
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

Deno.test("workflowBase returns filename from path", () => {
  assertEquals(workflowBase(".github/workflows/release.yml"), "release.yml");
});

Deno.test("parseWorkflowFields parses raw and magic fields", async () => {
  const fields = await parseWorkflowFields(
    ["greeting=hello"],
    ["name=@/tmp/name.txt"],
    (path) => {
      assertEquals(path, "/tmp/name.txt");
      return Promise.resolve("scully");
    },
  );
  assertEquals(fields, { greeting: "hello", name: "scully" });
});

Deno.test("parseWorkflowFields rejects fields without equals", async () => {
  await assertRejects(
    () => parseWorkflowFields(["invalid"], [], () => Promise.resolve("")),
    Error,
    "requires a value separated by an '=' sign",
  );
});

Deno.test("resolveWorkflow fetches by numeric id", async () => {
  const workflow = activeWorkflow({
    id: 42,
    name: "CI",
    path: ".github/workflows/ci.yml",
  });

  await withStubFetch((input) => {
    const url = String(input);
    if (url.includes("/actions/workflows/42")) {
      return Promise.resolve(
        new Response(JSON.stringify(workflow), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }, async () => {
    const result = await resolveWorkflow(OWNER, REPO, "42");
    assertEquals(result, workflow);
  });
});

Deno.test("resolveWorkflow fetches by workflow filename", async () => {
  const workflow = activeWorkflow({
    id: 7,
    name: "Release",
    path: ".github/workflows/release.yml",
  });

  await withStubFetch((input) => {
    const url = String(input);
    if (url.includes("/actions/workflows/release.yml")) {
      return Promise.resolve(
        new Response(JSON.stringify(workflow), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }, async () => {
    const result = await resolveWorkflow(OWNER, REPO, "release.yml");
    assertEquals(result.id, 7);
  });
});

Deno.test("resolveWorkflow matches unique display name", async () => {
  const workflows = {
    total_count: 2,
    workflows: [
      activeWorkflow({
        id: 1,
        name: "CI",
        path: ".github/workflows/ci.yml",
      }),
      activeWorkflow({
        id: 2,
        name: "Release",
        path: ".github/workflows/release.yml",
      }),
    ],
  };

  await withStubFetch((input) => {
    const url = String(input);
    if (url.includes("/actions/workflows?")) {
      return Promise.resolve(
        new Response(JSON.stringify(workflows), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }, async () => {
    const result = await resolveWorkflow(OWNER, REPO, "Release");
    assertEquals(result.id, 2);
  });
});

Deno.test("resolveWorkflow errors on ambiguous name", async () => {
  const workflows = {
    total_count: 2,
    workflows: [
      activeWorkflow({
        id: 1,
        name: "Deploy",
        path: ".github/workflows/deploy-a.yml",
      }),
      activeWorkflow({
        id: 2,
        name: "Deploy",
        path: ".github/workflows/deploy-b.yml",
      }),
    ],
  };

  await withStubFetch((input) => {
    const url = String(input);
    if (url.includes("/actions/workflows?")) {
      return Promise.resolve(
        new Response(JSON.stringify(workflows), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }, async () => {
    await assertRejects(
      () => resolveWorkflow(OWNER, REPO, "Deploy"),
      Error,
      "could not resolve to a unique workflow",
    );
  });
});

Deno.test("resolveWorkflow errors when name not found", async () => {
  await withStubFetch(
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ total_count: 0, workflows: [] }),
          { status: 200 },
        ),
      ),
    async () => {
      await assertRejects(
        () => resolveWorkflow(OWNER, REPO, "Missing"),
        Error,
        "could not find any workflows named Missing",
      );
    },
  );
});

Deno.test("dispatchWorkflow posts ref inputs and return_run_details", async () => {
  let capturedBody = "";

  await withStubFetch((_input, init) => {
    capturedBody = init?.body as string;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          workflow_run_id: 99,
          run_url: "https://api.github.com/repos/acme/platform/actions/runs/99",
          html_url: "https://github.com/acme/platform/actions/runs/99",
        }),
        { status: 200 },
      ),
    );
  }, async () => {
    const result = await dispatchWorkflow(OWNER, REPO, 42, {
      ref: "main",
      inputs: { tag: "v1.0.0" },
    });

    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    assertEquals(body.ref, "main");
    assertEquals(body.return_run_details, true);
    assertEquals((body.inputs as Record<string, string>).tag, "v1.0.0");
    assertEquals(result.workflowRunId, 99);
    assertEquals(
      result.htmlUrl,
      "https://github.com/acme/platform/actions/runs/99",
    );
  });
});

Deno.test("dispatchWorkflow handles 204 response", async () => {
  await withStubFetch(
    () => Promise.resolve(new Response(null, { status: 204 })),
    async () => {
      const result = await dispatchWorkflow(OWNER, REPO, 1, { ref: "main" });
      assertEquals(result, {});
    },
  );
});
