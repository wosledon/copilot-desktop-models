import { cp, access, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extensions", "models-dev-providers");
const copilotHome = process.env.COPILOT_HOME?.trim()
    ? path.resolve(process.env.COPILOT_HOME.trim())
    : path.join(os.homedir(), ".copilot");
const extensionsDir = path.join(copilotHome, "extensions");
const target = path.join(extensionsDir, "models-dev-providers");

try {
    await access(path.join(source, "extension.mjs"));
} catch {
    console.error(`Extension source not found at ${source}`);
    process.exit(1);
}

await mkdir(extensionsDir, { recursive: true, mode: 0o700 });
await rm(target, { recursive: true, force: true });

await cp(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => {
        const relative = path.relative(source, entry);
        return relative !== "test" && !relative.startsWith(`test${path.sep}`);
    },
});

console.log(`Installed Models.dev Providers to ${target}`);
console.log("Start a new Copilot session (or reload extensions), then open Canvases → Models.dev Providers.");
