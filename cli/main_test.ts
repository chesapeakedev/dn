import { assert } from "@std/assert";

Deno.test("CLI rejects unknown subcommand", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--quiet", "cli/main.ts", "notasubcommand"],
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
