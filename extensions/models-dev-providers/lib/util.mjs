import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

export const MAX_TOKEN_LIMIT = 4_294_967_295;

/** Returns a positive whole token limit, or undefined for unusable input. */
export function tokenLimit(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.min(Math.floor(value), MAX_TOKEN_LIMIT);
}

/**
 * Normalizes a provider base URL. Copilot accepts HTTP(S) endpoints only.
 * Anthropic clients append `/v1/messages`, so a trailing `/v1` is removed.
 */
export function normalizeBaseUrl(value, type = "openai") {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    let url;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.search || url.hash) return null;

    let pathname = url.pathname.replace(/\/+$/, "");
    if (type === "anthropic" && /\/v1$/i.test(pathname)) {
        pathname = pathname.slice(0, -3);
    }
    url.pathname = pathname || "/";

    return url.toString().replace(/\/$/, "");
}

/** True for endpoints that normally do not need an API key. */
export function isLocalBaseUrl(value) {
    if (typeof value !== "string") return false;
    try {
        const host = new URL(value).hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
    } catch {
        return false;
    }
}

export function safeWebUrl(value) {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
    } catch {
        return null;
    }
}

export function cleanString(value, maxLength = 512) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLength) return null;
    // Control characters break JSON logs, terminals, and model IDs.
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
    return trimmed;
}

/** Writes JSON through a same-directory temporary file and rename. */
export async function writeJsonAtomic(filePath, value, { mode = 0o600, pretty = true } = {}) {
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const tempPath = path.join(
        directory,
        `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
    );
    const body = `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
    let handle;

    try {
        handle = await open(tempPath, "wx", mode);
        await handle.writeFile(body, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;

        let lastError;
        for (const delay of [0, 40, 120]) {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            try {
                await rename(tempPath, filePath);
                lastError = undefined;
                break;
            } catch (error) {
                lastError = error;
                if (error.code !== "EPERM" && error.code !== "EACCES" && error.code !== "EBUSY") break;
            }
        }
        if (lastError) throw lastError;

        if (process.platform !== "win32") await chmod(filePath, mode);
    } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await rm(tempPath, { force: true }).catch(() => {});
        throw error;
    }
}

export function publicError(error, fallback = "Something went wrong.") {
    if (!error) return fallback;
    if (typeof error === "string") return error;
    if (typeof error.message === "string" && error.message) return error.message;
    return fallback;
}
