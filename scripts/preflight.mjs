import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const { name, version } = pkg;

function fail(message, hint) {
  console.error(`\npreflight: ${message}`);
  if (hint) console.error(`           ${hint}\n`);
  process.exit(1);
}

// Keep src/server.ts and server.json on the version in package.json.
execFileSync("node", [resolve(root, "scripts/sync-version.mjs")], { stdio: "inherit" });

const dirty = execFileSync("git", ["status", "--porcelain", "src/server.ts", "server.json"], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (dirty) {
  console.warn(
    `\npreflight: version files were out of sync and have been rewritten.\n` +
      `           Commit them so git matches what is being published:\n` +
      `           git commit -am "sync version to ${version}"\n`
  );
}

// Refuse to republish a version that is already on the registry.
let published = [];
try {
  published = JSON.parse(
    execFileSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  );
} catch {
  console.warn("preflight: could not reach the npm registry, skipping duplicate-version check");
}

if (Array.isArray(published) && published.includes(version)) {
  fail(
    `${name}@${version} is already published.`,
    "Bump first: npm version patch (or minor / major), then npm publish."
  );
}

console.log(`preflight: ready to publish ${name}@${version}`);
