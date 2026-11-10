import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = path.join(root, "extensions", "models-dev-providers", "test");
const files = (await readdir(testDirectory))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(testDirectory, name));

if (!files.length) {
    console.error("No test files found.");
    process.exit(1);
}

execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
