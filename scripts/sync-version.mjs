import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;

function syncServerTs() {
  const path = resolve(root, "src/server.ts");
  const content = readFileSync(path, "utf8");
  const updated = content.replace(/version:\s*"[^"]*"/, `version: "${version}"`);

  if (content !== updated) {
    writeFileSync(path, updated);
    console.log(`Synced server.ts version to ${version}`);
  } else {
    console.log(`server.ts already at ${version}`);
  }
}

function syncServerJson() {
  const path = resolve(root, "server.json");
  const content = readFileSync(path, "utf8");
  const manifest = JSON.parse(content);

  if (manifest.version === version && manifest.packages?.every((p) => p.version === version)) {
    console.log(`server.json already at ${version}`);
    return;
  }

  manifest.version = version;
  for (const pkgEntry of manifest.packages ?? []) {
    pkgEntry.version = version;
  }

  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Synced server.json version to ${version}`);
}

syncServerTs();
syncServerJson();
