import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manual = [];
const RELEASE_BRANCH = "main";
const DEV_BRANCH = "dev";

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
const registryPublished = run("publishing to the MCP registry", "mcp-publisher", ["publish"]);

console.log(`\npostpublish: ${pkg.name}@${pkg.version} is live on npm.`);

if (manual.length) {
  console.log("\n  ⚠ Some follow-up steps did not complete:");
  for (const item of manual) console.log(`    - ${item}`);
  if (!registryPublished) console.log("    (mcp-publisher needs a valid login: mcp-publisher login github)");
}

// Released from main (after merging dev): only dev is behind, by the version commit.
// Released from any other branch: the release still has to reach main through a PR.
const remaining =
  branch === RELEASE_BRANCH
    ? `bring ${DEV_BRANCH} up to date: git checkout ${DEV_BRANCH} && git merge --ff-only ${RELEASE_BRANCH} && git push origin ${DEV_BRANCH}`
    : `open a PR from ${branch} into ${RELEASE_BRANCH}.`;
console.log(`\n  Remaining by hand: ${remaining}\n`);
