import { assert } from "@std/assert";

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
