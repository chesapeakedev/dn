import { assert, assertEquals } from "@std/assert";
import { cleanupTestRepo, createTestRepo, runDnCommand } from "./test_utils.ts";

Deno.test("dn tidy agent checks and creates OpenCode phase configs", async () => {
  const testRepo = await createTestRepo({
    initialFiles: {
      "dn.json": '{"schema_version":"2.0","agent":"opencode"}\n',
    },
  });
  try {
    const check = await runDnCommand(["tidy", "agent", "--check"], {
      cwd: testRepo.path,
      expectFailure: true,
    });
    assertEquals(check.success, false);
    assert(check.stdout.includes("missing"));

    const fix = await runDnCommand(["tidy", "agent", "--fix"], {
      cwd: testRepo.path,
    });
    assert(fix.success);
    assert(fix.stdout.includes("fixed"));

    const plan = JSON.parse(
      await Deno.readTextFile(`${testRepo.path}/opencode.plan.json`),
    );
    const implement = JSON.parse(
      await Deno.readTextFile(`${testRepo.path}/opencode.implement.json`),
    );
    assertEquals(plan.$schema, "https://opencode.ai/config.json");
    assertEquals(plan.permission.edit["plans/**/*.plan.md"], "allow");
    assertEquals(plan.permission.edit["**/*.plan.md"], "allow");
    assertEquals(implement.$schema, "https://opencode.ai/config.json");
    assertEquals(implement.permission.edit["*"], "allow");

    const secondFix = await runDnCommand(["tidy", "agent", "--fix"], {
      cwd: testRepo.path,
    });
    assert(secondFix.success);
    assertEquals(
      secondFix.stdout.match(/^(?:ok|fixed|missing) /gm)?.filter((line) =>
        line.startsWith("fixed ")
      ).length ?? 0,
      0,
    );

    const secondCheck = await runDnCommand(["tidy", "agent", "--check"], {
      cwd: testRepo.path,
    });
    assert(secondCheck.success);
    assert(secondCheck.stdout.includes("ok"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("dn tidy agent patches missing OpenCode plan permissions", async () => {
  const testRepo = await createTestRepo({
    initialFiles: {
      "dn.json": '{"schema_version":"2.0","agent":"opencode"}\n',
      "opencode.plan.json": '{"permission":{"edit":{"*":"deny"}}}\n',
      "opencode.implement.json": '{"permission":{"edit":{"*":"allow"}}}\n',
    },
  });
  try {
    const fix = await runDnCommand(["tidy", "agent", "--fix"], {
      cwd: testRepo.path,
    });
    assert(fix.success);
    const plan = JSON.parse(
      await Deno.readTextFile(`${testRepo.path}/opencode.plan.json`),
    );
    assertEquals(plan.permission.edit["plans/*.plan.md"], "allow");
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("dn tidy agent resolves an OpenCode agent from user config", async () => {
  const testRepo = await createTestRepo({
    initialFiles: {
      ".dn/config.json": '{"schema_version":"2.0","agent":"opencode"}\n',
    },
  });
  try {
    const check = await runDnCommand(["tidy", "agent", "--check"], {
      cwd: testRepo.path,
      env: { HOME: testRepo.path },
      expectFailure: true,
    });
    assert(!check.success);
    assert(check.stdout.includes("missing"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("dn tidy config validates repository and legacy configuration", async () => {
  const testRepo = await createTestRepo({
    initialFiles: {
      ".github/dn/config.json":
        '{"schema_version":"2.0","sandbox":{"provider":"none"}}\n',
    },
  });
  try {
    const result = await runDnCommand(["tidy", "config", "--json"], {
      cwd: testRepo.path,
    });
    assert(result.success);
    const output = JSON.parse(result.stdout);
    assertEquals(output.ok, true);
    assertEquals(output.config.sources.sandbox, "repository");
    assertEquals(output.warnings, []);
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("dn tidy help documents cheap all-surfaces mode", async () => {
  const result = await runDnCommand(["tidy", "--help"]);
  assert(result.success);
  assert(result.stdout.includes("dn tidy --all [--with-backlog] [--json]"));
  assert(result.stdout.includes("dn tidy config [--json]"));
});
