const args = new Map<string, string>();
for (let index = 0; index < Deno.args.length; index += 1) {
  const argument = Deno.args[index];
  if (!argument.startsWith("--")) continue;
  const key = argument.slice(2);
  const value = Deno.args[index + 1];
  if (value == null || value.startsWith("--")) {
    throw new Error(`Missing value for --${key}.`);
  }
  args.set(key, value);
  index += 1;
}

const profile = args.get("profile");
const threshold = Number(args.get("threshold") ?? "90");
if (profile == null) throw new Error("--profile is required.");
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  throw new Error("--threshold must be between 0 and 100.");
}

const command = new Deno.Command("deno", {
  args: [
    "coverage",
    "--include=^file:.*\\/sdk\\/runner\\/(worker|client|bootstrap|cloudCheckout|doctor|config)\\.ts$",
    "--lcov",
    profile,
  ],
  stdout: "piped",
  stderr: "piped",
});
const result = await command.output();
if (!result.success) {
  throw new Error(new TextDecoder().decode(result.stderr));
}

const lcov = new TextDecoder().decode(result.stdout);
let covered = 0;
let total = 0;
let currentFile = "";
const uncovered: string[] = [];
for (const line of lcov.split("\n")) {
  if (line.startsWith("SF:")) currentFile = line.slice(3);
  else if (line.startsWith("LF:")) total += Number(line.slice(3));
  else if (line.startsWith("LH:")) covered += Number(line.slice(3));
  else if (line.startsWith("DA:") && line.endsWith(",0")) {
    uncovered.push(`${currentFile}:${line.slice(3, line.lastIndexOf(","))}`);
  }
}

const percentage = total === 0 ? 100 : (covered / total) * 100;
console.log(
  `dn runner statement coverage ${
    percentage.toFixed(2)
  }% (${covered}/${total})`,
);
if (uncovered.length > 0) {
  console.log("Uncovered lines");
  console.log(uncovered.join("\n"));
}
if (percentage < threshold) {
  throw new Error(
    `dn runner statement coverage ${
      percentage.toFixed(2)
    }% is below ${threshold}%.`,
  );
}
