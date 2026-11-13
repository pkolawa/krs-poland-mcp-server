import { execFileSync } from "child_process";
import { readFileSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const artifact = resolve(root, "build/index.mjs");

function fail(message) {
  console.error(`\nverify-artifact: ${message}\n`);
  process.exit(1);
}

let stats;
try {
  stats = statSync(artifact);
} catch {
  fail("build/index.mjs is missing — run npm run build.");
}

const contents = readFileSync(artifact, "utf8");

if (!contents.startsWith("#!/usr/bin/env node")) {
  fail("build/index.mjs has no node shebang — the bin entry would not be executable.");
}

if (!contents.includes(`version: "${pkg.version}"`)) {
  fail(`build/index.mjs does not report version ${pkg.version} — it is a stale bundle.`);
}

// The bundle is gitignored, so a leftover build from an earlier release is the real risk.
const newestSource = execFileSync("git", ["ls-files", "src", "build.mjs", "package.json"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .reduce((newest, file) => Math.max(newest, statSync(resolve(root, file)).mtimeMs), 0);

if (stats.mtimeMs < newestSource) {
  fail("build/index.mjs is older than the sources — run npm run build.");
}

console.log(`verify-artifact: build/index.mjs is current for ${pkg.version}`);
