import { assert } from "@std/assert";
import { cleanupTestRepo, createTestRepo, runDnCommand } from "./test_utils.ts";

Deno.test("CLI rejects unknown subcommand", async () => {
  // The subprocess needs --allow-env because npm packages like graphql
  // access process.env.NODE_ENV at module load time. Deno's scoped env
  // permissions don't work correctly with npm packages accessing process.env.
  // Also needs --allow-read for @std/dotenv to load .env files.
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-read",
      "--quiet",
      "cli/main.ts",
      "notasubcommand",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr, stdout } = await command.output();

  const stdoutText = new TextDecoder().decode(stdout);
  console.log(stdoutText);
  const errorText = new TextDecoder().decode(stderr);
  console.log(errorText);

  assert(code !== 0);
  // Error output should mention an unknown subcommand or show usage
  assert(
    errorText.includes("Unknown subcommand"),
  );
});

Deno.test("CLI accepts top-level --agent before subcommand", async () => {
  const testRepo = await createTestRepo();
  try {
    const result = await runDnCommand(["--agent", "codex", "prep", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.success);
    assert(result.stdout.includes("dn prep"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});

Deno.test("CLI accepts top-level agent alias before subcommand", async () => {
  const testRepo = await createTestRepo();
  try {
    const result = await runDnCommand(["--codex", "loop", "--help"], {
      cwd: testRepo.path,
    });

    assert(result.success);
    assert(result.stdout.includes("dn loop"));
  } finally {
    await cleanupTestRepo(testRepo);
  }
});
