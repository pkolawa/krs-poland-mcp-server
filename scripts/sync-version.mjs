import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;

const serverPath = resolve(root, "src/server.ts");
const content = readFileSync(serverPath, "utf8");
const updated = content.replace(
  /version:\s*"[^"]*"/,
  `version: "${version}"`
);

if (content !== updated) {
  writeFileSync(serverPath, updated);
  console.log(`Synced server.ts version to ${version}`);
} else {
  console.log(`server.ts already at ${version}`);
}
