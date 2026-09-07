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
    assertEquals(plan.permission.edit["plans/**/*.plan.md"], "allow");
    assertEquals(plan.permission.edit["**/*.plan.md"], "allow");

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
