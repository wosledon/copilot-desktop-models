import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ConfigError, normalizeReasoningLevels, prepareModels } from "./config.mjs";
import {
    deleteAppCredential,
    deleteAppProvider,
    deleteAppProviderCredentials,
    readAppCredential,
    readAppRegistry,
    upsertAppProvider,
    writeAppCredential,
} from "./app-registry.mjs";
import { registerProviderLive, unregisterProviderLive } from "./live.mjs";
import { cleanString, isLocalBaseUrl, normalizeBaseUrl, publicError } from "./util.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const STATIC_FILES = new Map([
    ["", ["index.html", "text/html; charset=utf-8"]],
    ["app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["favicon.svg", ["favicon.svg", "image/svg+xml"]],
]);
const MAX_BODY_BYTES = 512 * 1024;
const SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
};
const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
].join("; ");

const staticCache = new Map();

async function staticFile(name) {
    if (staticCache.has(name)) return staticCache.get(name);
    const promise = readFile(path.join(PUBLIC_DIR, name));
    staticCache.set(name, promise);
    return promise;
}

function requestToken(req, url) {
    return url.pathname.split("/")[1] || "";
}

function safeEqual(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req) {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
        throw new ConfigError("Send this request as JSON.", { code: "unsupported_media_type", status: 415 });
    }

    let total = 0;
    const chunks = [];
    for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
            throw new ConfigError("The request body is too large.", { code: "payload_too_large", status: 413 });
        }
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new ConfigError("The request body is not valid JSON.", { code: "invalid_json", status: 400 });
    }
}

function encodeBody(req, body) {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const acceptsGzip = /\bgzip\b/i.test(String(req?.headers?.["accept-encoding"] || ""));
    if (buffer.length < 1024 || !acceptsGzip) return { body: buffer, headers: {} };
    return {
        body: gzipSync(buffer),
        headers: { "Content-Encoding": "gzip", Vary: "Accept-Encoding" },
    };
}

function sendJson(res, status, value) {
    const encoded = encodeBody(res.req, JSON.stringify(value));
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": encoded.body.length,
        ...encoded.headers,
        ...SECURITY_HEADERS,
    });
    res.end(encoded.body);
}

function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
    res.end(text);
}

function catalogForUi(catalog) {
    return {
        providers: catalog.providers,
        counts: catalog.counts,
        fetchedAt: catalog.fetchedAt,
        checkedAt: catalog.checkedAt,
        stale: catalog.stale,
        fromCache: catalog.fromCache,
        error: catalog.error,
    };
}

/** The canvas-facing view of the app's provider registry. */
function appConfigured(registry) {
    const providers = [];
    const models = [];

    for (const app of registry.providers) {
        providers.push({
            name: app.name,
            appId: app.id,
            type: app.type === "anthropic" ? "anthropic" : "openai",
            baseUrl: app.baseUrl,
            wireApi: app.wireApi,
            hasApiKey: app.authKind === "api_key",
            hasBearerToken: app.authKind === "bearer_token",
            isLocal: isLocalBaseUrl(app.baseUrl),
            headerNames: [],
        });

        for (const model of app.models) {
            const supports = { vision: model.vision === true };
            if (model.efforts?.length) supports.reasoning_effort = [...model.efforts];
            const view = {
                id: model.id,
                provider: app.name,
                name: model.name,
                capabilities: { supports },
            };
            if (model.wireModel && model.wireModel !== model.id) view.wireModel = model.wireModel;
            if (model.maxPromptTokens) view.maxPromptTokens = model.maxPromptTokens;
            if (model.maxOutputTokens) view.maxOutputTokens = model.maxOutputTokens;
            models.push(view);
        }
    }

    return {
        providers,
        models,
        counts: { providers: providers.length, models: models.length },
        appRegistry: registry.available,
    };
}

function publicState({ appDatabasePath, registry, registryError, catalog, session }) {
    return {
        version: 2,
        modelsDevUrl: "https://models.dev",
        storage: "app",
        appDatabasePath: registry.available ? appDatabasePath : null,
        registryError: registryError || null,
        configured: appConfigured(registry),
        catalog: catalogForUi(catalog),
        session: {
            liveProviderApi: Boolean(session?.rpc?.provider?.add && session?.rpc?.provider?.withdraw),
        },
    };
}

function appModelsAsConfig(app) {
    return app.models.map((model) => ({
        id: model.id,
        provider: app.name,
        name: model.name,
        wireModel: model.wireModel,
        maxPromptTokens: model.maxPromptTokens ?? undefined,
        maxOutputTokens: model.maxOutputTokens ?? undefined,
        capabilities: {
            supports: {
                vision: model.vision === true,
                ...(model.efforts?.length ? { reasoning_effort: [...model.efforts] } : {}),
            },
        },
    }));
}

/**
 * Starts the loopback-only canvas server. Every instance gets its own random
 * URL path; requests without the token, or with a foreign Host/Origin, fail.
 */
export async function startCanvasServer({
    appDatabasePath,
    backupDir = null,
    catalogService,
    session = null,
    logger = null,
    preferredPorts = Array.from({ length: 20 }, (_, index) => 47_960 + index),
} = {}) {
    if (!appDatabasePath) throw new Error("startCanvasServer requires an appDatabasePath.");
    if (!catalogService) throw new Error("startCanvasServer requires a catalogService.");

    const token = randomBytes(24).toString("base64url");
    const prefix = `/${token}/`;
    let origin = "";
    let writeQueue = Promise.resolve();

    const withWriteLock = (operation) => {
        const next = writeQueue.then(operation, operation);
        writeQueue = next.catch(() => {});
        return next;
    };

    const authorized = (req, url) => {
        if (!origin || req.headers.host !== new URL(origin).host) return false;
        if (req.headers.origin && req.headers.origin !== origin) return false;
        return safeEqual(requestToken(req, url), token);
    };

    async function readRegistry() {
        return readAppRegistry(appDatabasePath);
    }

    async function getState() {
        const registryError = [];
        const registry = await readRegistry().catch((error) => {
            const message = publicError(error, "Could not read the Copilot app provider registry.");
            registryError.push(message);
            logger?.warn?.(message);
            return { available: false, providers: [] };
        });
        if (!registry.available) {
            registryError.push(
                "Copilot Desktop's provider database (data.db) was not found, so providers cannot be listed.",
            );
        }
        const catalog = await catalogService.get();

        return publicState({
            appDatabasePath,
            registry,
            registryError: registryError.length ? registryError.join(" ") : null,
            catalog,
            session,
        });
    }

    function validateDisplayName(value) {
        const name = cleanString(value, 80);
        if (!name || name.includes("/")) {
            throw new ConfigError("Enter a provider name of 1-80 characters without a slash.");
        }
        return name;
    }

    async function saveAppProvider(body, catalog, registry) {
        const input = body.provider;
        if (!input || typeof input !== "object") throw new ConfigError("Provider details are missing.");

        if ((input.type || "openai") !== "openai") {
            throw new ConfigError(
                "Copilot Desktop's Other Providers currently supports OpenAI-compatible endpoints.",
            );
        }

        const name = validateDisplayName(input.name);
        const baseUrl = normalizeBaseUrl(input.baseUrl, "openai");
        if (!baseUrl) {
            throw new ConfigError("Enter a valid HTTP(S) base URL without credentials, a query string, or a fragment.");
        }

        const wireApi = input.wireApi === "responses" ? "responses" : "completions";
        const authMode = input.auth?.mode || "none";
        if (!["apiKey", "bearer", "none"].includes(authMode)) {
            throw new ConfigError("Choose how this provider authenticates.");
        }

        const existingApp = (body.appProviderId
            ? registry.providers.find((provider) => provider.id === body.appProviderId)
            : null)
            || registry.providers.find((provider) => provider.name === name)
            || null;

        if (!body.appProviderId && registry.providers.some((provider) => provider.name === name)) {
            throw new ConfigError(
                `An app provider named "${name}" already exists. Open it from the installed list to edit it.`,
                { code: "duplicate_provider", status: 409 },
            );
        }

        const catalogProvider = catalog.providers.find((provider) => provider.id === body.catalogProviderId)
            || catalog.providers.find((provider) => provider.name === name)
            || null;

        const models = prepareModels({
            providerName: name,
            selected: body.models,
            existingModels: existingApp ? appModelsAsConfig(existingApp) : [],
            catalogProvider,
        });

        const appModels = models.map((model) => ({
            id: model.id,
            name: model.name || model.id,
            wireModel: model.wireModel || model.id,
            maxPromptTokens: model.maxPromptTokens ?? null,
            maxOutputTokens: model.maxOutputTokens ?? null,
            reasoningEfforts: normalizeReasoningLevels(model.capabilities?.supports?.reasoning_effort || []),
            vision: model.capabilities?.supports?.vision === true,
            wireApiOverride: null,
        }));

        const authKind = authMode === "apiKey" ? "api_key" : authMode === "bearer" ? "bearer_token" : "none";
        const secret = typeof input.auth?.value === "string" ? input.auth.value.trim() : "";
        const previousKind = existingApp?.authKind;

        if (authMode !== "none" && !secret && !(existingApp && previousKind === authKind)) {
            throw new ConfigError(
                `Enter ${authMode === "bearer" ? "a bearer token" : "an API key"}, or choose No authentication.`,
            );
        }

        let credentialNote = null;
        let liveCredential = secret || null;

        const { id: providerId } = await upsertAppProvider(appDatabasePath, {
            appId: existingApp?.id || null,
            name,
            type: "custom",
            baseUrl,
            wireApi,
            authKind,
        }, appModels, { backupDir, logger });

        if (authMode === "none") {
            if (existingApp && existingApp.authKind !== "none") {
                await deleteAppProviderCredentials(providerId, logger);
            }
        } else if (secret) {
            const written = await writeAppCredential(providerId, authKind, secret);
            if (!written.ok) credentialNote = written.message;
            if (existingApp?.authKind && existingApp.authKind !== "none" && existingApp.authKind !== authKind) {
                const otherKind = authKind === "api_key" ? "bearer_token" : "api_key";
                await deleteAppCredential(providerId, otherKind).catch(() => {});
            }
        } else {
            liveCredential = await readAppCredential(providerId, authKind);
            if (!liveCredential) {
                credentialNote = "The stored credential could not be read; re-enter the key to use this provider now.";
            }
        }

        let live = { ok: false, skipped: true, message: "Saved to Copilot Desktop's Other Providers." };
        if (body.activate === true && authMode === "none") {
            live = await registerProviderLive(
                session,
                { name: providerId, type: "openai", baseUrl, wireApi, modelProvider: "openai" },
                appModels.map((model) => ({
                    id: model.id,
                    provider: providerId,
                    name: model.name,
                    wireModel: model.wireModel,
                    maxPromptTokens: model.maxPromptTokens ?? undefined,
                    maxOutputTokens: model.maxOutputTokens ?? undefined,
                    capabilities: {
                        supports: {
                            vision: model.vision === true,
                            ...(model.reasoningEfforts.length
                                ? { reasoning_effort: model.reasoningEfforts }
                                : {}),
                        },
                    },
                })),
            );
        } else if (body.activate === true && liveCredential) {
            live = await registerProviderLive(
                session,
                {
                    name: providerId,
                    type: "openai",
                    baseUrl,
                    wireApi,
                    modelProvider: "openai",
                    ...(authKind === "api_key" ? { apiKey: liveCredential } : {}),
                    ...(authKind === "bearer_token" ? { bearerToken: liveCredential } : {}),
                },
                appModels.map((model) => ({
                    id: model.id,
                    provider: providerId,
                    name: model.name,
                    wireModel: model.wireModel,
                    maxPromptTokens: model.maxPromptTokens ?? undefined,
                    maxOutputTokens: model.maxOutputTokens ?? undefined,
                    capabilities: {
                        supports: {
                            vision: model.vision === true,
                            ...(model.reasoningEfforts.length
                                ? { reasoning_effort: model.reasoningEfforts }
                                : {}),
                        },
                    },
                })),
            );
        }

        return {
            providerId,
            providerName: name,
            live,
            credentialNote,
            created: !existingApp,
        };
    }

    async function handleAdd(req, res) {
        const body = await readJson(req);
        if (body.activate !== undefined && typeof body.activate !== "boolean") {
            throw new ConfigError("activate must be true or false.");
        }

        const registry = await readRegistry();
        if (!registry.available) {
            throw new ConfigError(
                "Copilot Desktop's provider database (data.db) was not found. Open Copilot Desktop once, then retry.",
                { code: "app_registry_unavailable", status: 503 },
            );
        }

        const catalog = await catalogService.get();
        const outcome = await withWriteLock(() => saveAppProvider(body, catalog, registry));
        const freshRegistry = await readRegistry();

        let message = outcome.live?.message;
        if (outcome.credentialNote) message = `${message || "Saved."} ${outcome.credentialNote}`;

        sendJson(res, outcome.created ? 201 : 200, {
            config: appConfigured(freshRegistry),
            providerName: outcome.providerName,
            providerId: outcome.providerId,
            storage: "app",
            live: { ...outcome.live, message },
        });
    }

    async function handleDelete(identifier, res) {
        const registry = await readRegistry();
        if (!registry.available) {
            throw new ConfigError(
                "Copilot Desktop's provider database (data.db) was not found.",
                { code: "app_registry_unavailable", status: 503 },
            );
        }

        const appProvider = registry.providers.find(
            (provider) => provider.id === identifier || provider.name === identifier,
        );
        if (!appProvider) {
            throw new ConfigError(`Provider "${identifier}" was not found.`, {
                code: "not_found",
                status: 404,
            });
        }

        await withWriteLock(async () => {
            await deleteAppProvider(appDatabasePath, appProvider.id);
            await deleteAppProviderCredentials(appProvider.id, logger);
            return true;
        });

        const live = await unregisterProviderLive(
            session,
            appProvider.id,
            appProvider.models.map((model) => model.id),
        );
        const freshRegistry = await readRegistry();

        sendJson(res, 200, {
            config: appConfigured(freshRegistry),
            storage: "app",
            live,
        });
    }

    const server = createServer(async (req, res) => {
        let url;
        try {
            url = new URL(req.url, "http://127.0.0.1");
        } catch {
            sendText(res, 400, "Bad request");
            return;
        }

        if (!authorized(req, url)) {
            sendText(res, 403, "Forbidden");
            return;
        }

        const route = url.pathname.slice(prefix.length);

        try {
            if (route === "" || STATIC_FILES.has(route)) {
                if (req.method !== "GET" && req.method !== "HEAD") {
                    res.writeHead(405, { Allow: "GET, HEAD", ...SECURITY_HEADERS });
                    res.end();
                    return;
                }
                const [fileName, contentType] = STATIC_FILES.get(route);
                const body = await staticFile(fileName);
                const encoded = encodeBody(req, body);
                res.writeHead(200, {
                    "Content-Type": contentType,
                    "Content-Length": encoded.body.length,
                    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
                    ...encoded.headers,
                    ...SECURITY_HEADERS,
                });
                if (req.method === "HEAD") res.end();
                else res.end(encoded.body);
                return;
            }

            if (route === "api/state") {
                if (req.method !== "GET") {
                    res.writeHead(405, { Allow: "GET", ...SECURITY_HEADERS });
                    res.end();
                    return;
                }
                sendJson(res, 200, await getState());
                return;
            }

            if (route === "api/refresh") {
                if (req.method !== "POST") {
                    res.writeHead(405, { Allow: "POST", ...SECURITY_HEADERS });
                    res.end();
                    return;
                }
                const catalog = await catalogService.refresh();
                sendJson(res, 200, { catalog: catalogForUi(catalog) });
                return;
            }

            if (route === "api/providers") {
                if (req.method !== "POST") {
                    res.writeHead(405, { Allow: "POST", ...SECURITY_HEADERS });
                    res.end();
                    return;
                }
                await handleAdd(req, res);
                return;
            }

            const deleteMatch = route.match(/^api\/providers\/([^/]+)$/);
            if (deleteMatch) {
                if (req.method !== "DELETE") {
                    res.writeHead(405, { Allow: "DELETE", ...SECURITY_HEADERS });
                    res.end();
                    return;
                }
                await handleDelete(decodeURIComponent(deleteMatch[1]), res);
                return;
            }

            sendText(res, 404, "Not found");
        } catch (error) {
            const status = error instanceof ConfigError ? error.status : 500;
            const code = error instanceof ConfigError ? error.code : "internal_error";
            if (status >= 500) logger?.warn?.(`Canvas request failed: ${publicError(error)}`);
            if (!res.headersSent) {
                sendJson(res, status, { error: { code, message: publicError(error, "The request failed.") } });
            } else {
                res.end();
            }
        }
    });

    const listen = (port) => new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
    });

    let bound = false;
    for (const port of preferredPorts) {
        try {
            await listen(port);
            bound = true;
            break;
        } catch (error) {
            if (error.code !== "EADDRINUSE" && error.code !== "EACCES") throw error;
        }
    }
    if (!bound) await listen(0);

    const address = server.address();
    origin = `http://127.0.0.1:${address.port}`;

    return {
        url: `${origin}${prefix}`,
        origin,
        port: address.port,
        async close() {
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
