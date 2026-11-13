import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manual = [];

function run(label, command, args) {
  process.stdout.write(`postpublish: ${label}\n`);
  try {
    execFileSync(command, args, { cwd: root, stdio: "inherit" });
    return true;
  } catch {
    manual.push(`${label} failed — run manually: ${command} ${args.join(" ")}`);
    return false;
  }
}

const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();

run(`pushing ${branch} and tags`, "git", ["push", "origin", branch, "--follow-tags"]);
run("publishing to the MCP registry", "mcp-publisher", ["publish"]);

console.log(`\npostpublish: ${pkg.name}@${pkg.version} is live on npm.`);

if (manual.length) {
  console.log("\n  ⚠ Some follow-up steps did not complete:");
  for (const item of manual) console.log(`    - ${item}`);
  console.log("    (mcp-publisher needs a login: mcp-publisher login github)");
}

console.log(`\n  Remaining by hand: open a PR from ${branch} into main.\n`);
