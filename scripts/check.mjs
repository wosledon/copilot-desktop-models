import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "extensions", "models-dev-providers");
const directories = [extensionDir, path.join(root, "scripts")];
const files = [];

async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
        const location = path.join(directory, entry.name);
        if (entry.isDirectory()) await collect(location);
        else if (/\.(?:mjs|js)$/.test(entry.name)) files.push(location);
    }
}

for (const directory of directories) await collect(directory);
for (const file of files) {
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log(`Syntax checked ${files.length} files.`);
