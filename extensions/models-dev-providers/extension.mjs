import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { CatalogService } from "./lib/catalog.mjs";
import { readAppRegistry } from "./lib/app-registry.mjs";
import { resolvePaths } from "./lib/config.mjs";
import { startCanvasServer } from "./lib/server.mjs";
import { publicError } from "./lib/util.mjs";

const paths = resolvePaths(process.env);
const servers = new Map();
const pendingServers = new Map();

let session;
const logger = {
    warn(message) {
        try {
            session?.log?.(String(message), { level: "warning", ephemeral: true });
        } catch {
            // Logging must never break the canvas.
        }
    },
};

const catalog = new CatalogService({
    cachePath: paths.cachePath,
    logger,
});

async function serverFor(instanceId) {
    if (servers.has(instanceId)) return servers.get(instanceId);
    if (pendingServers.has(instanceId)) return pendingServers.get(instanceId);

    const pending = startCanvasServer({
        appDatabasePath: paths.appDatabasePath,
        backupDir: paths.backupDir,
        catalogService: catalog,
        session,
        logger,
    }).then((server) => {
        servers.set(instanceId, server);
        pendingServers.delete(instanceId);
        return server;
    }).catch((error) => {
        pendingServers.delete(instanceId);
        throw error;
    });

    pendingServers.set(instanceId, pending);
    return pending;
}

function normalizeLimit(value, fallback = 20) {
    if (!Number.isInteger(value)) return fallback;
    return Math.max(1, Math.min(value, 50));
}

function searchCatalog(providers, query, providerFilter, limit) {
    const needle = String(query || "").trim().toLowerCase();
    const providerMatches = [];
    const modelMatches = [];

    for (const provider of providers) {
        if (provider.compatibility === "builtin") continue;
        if (providerFilter && provider.id !== providerFilter) continue;

        const providerText = `${provider.id} ${provider.name} ${provider.npm || ""}`.toLowerCase();
        const providerHit = !needle || providerText.includes(needle);
        if (providerHit) {
            providerMatches.push({
                id: provider.id,
                name: provider.name,
                compatibility: provider.compatibility,
                type: provider.type,
                modelCount: provider.modelCount,
            });
        }

        for (const model of provider.models) {
            if (modelMatches.length >= limit) break;
            const modelText = `${model.id} ${model.name} ${model.family || ""}`.toLowerCase();
            if (needle ? modelText.includes(needle) : providerHit) {
                modelMatches.push({
                    provider: provider.id,
                    providerName: provider.name,
                    selectionId: `${provider.id}/${model.id}`,
                    id: model.id,
                    name: model.name,
                    context: model.context,
                    maxOutput: model.output,
                    toolCalls: model.toolCalls,
                    vision: model.vision,
                    reasoning: model.reasoning,
                    status: model.status,
                });
                if (modelMatches.length >= limit) break;
            }
        }
        if (modelMatches.length >= limit && (!needle || providerMatches.length >= limit)) break;
    }

    return {
        providers: providerMatches.slice(0, limit),
        models: modelMatches.slice(0, limit),
    };
}

session = await joinSession({
    canvases: [
        createCanvas({            id: "models-dev-providers",
            displayName: "Models.dev Providers",
            description: "Browse models.dev and add OpenAI-compatible, Anthropic, or Azure providers to Copilot Desktop.",
            inputSchema: {
                type: "object",
                properties: {
                    providerId: {
                        type: "string",
                        description: "Optional models.dev provider ID to focus when the canvas opens.",
                    },
                },
            },
            actions: [
                {
                    name: "search_catalog",
                    description: "Search models.dev providers and chat models. Returns metadata only, never credentials.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Provider or model name to search for." },
                            providerId: { type: "string", description: "Restrict results to one models.dev provider." },
                            limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum results per list." },
                        },
                    },
                    handler: async (ctx) => {
                        const limit = normalizeLimit(ctx.input?.limit);
                        const providerFilter = typeof ctx.input?.providerId === "string" && ctx.input.providerId
                            ? ctx.input.providerId
                            : null;
                        const result = await catalog.get();
                        const matches = searchCatalog(
                            result.providers,
                            ctx.input?.query,
                            providerFilter,
                            limit,
                        );
                        return {
                            ...matches,
                            catalog: {
                                stale: result.stale,
                                fetchedAt: result.fetchedAt,
                                error: result.error,
                            },
                        };
                    },
                },
                {
                    name: "list_configured",
                    description: "List providers and models in Copilot Desktop's Other Providers registry. Credentials are never returned.",
                    inputSchema: { type: "object", properties: {} },
                    handler: async () => {
                        try {
                            const registry = await readAppRegistry(paths.appDatabasePath);
                            return {
                                appDatabasePath: registry.available ? paths.appDatabasePath : null,
                                available: registry.available,
                                providers: registry.providers.map((provider) => ({
                                    id: provider.id,
                                    name: provider.name,
                                    baseUrl: provider.baseUrl,
                                    wireApi: provider.wireApi,
                                    authKind: provider.authKind,
                                    models: provider.models.map((model) => ({
                                        id: model.id,
                                        name: model.name,
                                        reasoningEffortLevels: model.efforts,
                                        vision: model.vision,
                                    })),
                                })),
                            };
                        } catch (error) {
                            return {
                                appDatabasePath: null,
                                available: false,
                                error: publicError(error),
                                providers: [],
                            };
                        }
                    },
                },
                {
                    name: "list_session_models",
                    description: "List the model selection IDs currently registered in this live session, including restored BYOK models. Credentials are never returned.",
                    inputSchema: { type: "object", properties: {} },
                    handler: async () => {
                        if (!session.rpc?.model?.list) {
                            return { error: "The live session does not expose a model registry." };
                        }
                        try {
                            const result = await session.rpc.model.list();
                            const list = Array.isArray(result?.list) ? result.list : [];
                            const models = list.slice(0, 300).map((entry) => {
                                if (typeof entry === "string") return { selectionId: entry };
                                const provider = entry?.provider?.id || entry?.providerId || null;
                                const id = entry?.id ?? null;
                                return {
                                    selectionId: entry?.selectionId
                                        || (provider && id ? `${provider}/${id}` : id),
                                    id,
                                    name: entry?.name ?? null,
                                    provider,
                                    capabilities: entry?.capabilities ?? null,
                                    supportedReasoningEfforts: entry?.supportedReasoningEfforts ?? null,
                                    defaultReasoningEffort: entry?.defaultReasoningEffort ?? null,
                                };
                            });
                            return { count: list.length, models };
                        } catch (error) {
                            return { error: publicError(error) };
                        }
                    },
                },
            ],
            open: async (ctx) => {
                const instanceId = ctx.instanceId || "default";
                const server = await serverFor(instanceId);
                let url = server.url;
                const focus = typeof ctx.input?.providerId === "string" ? ctx.input.providerId.trim() : "";
                if (focus && /^[A-Za-z0-9._-]{1,100}$/.test(focus)) {
                    url += `?provider=${encodeURIComponent(focus)}`;
                }
                return {
                    title: "Models.dev Providers",
                    status: "models.dev",
                    url,
                };
            },
            onClose: async (ctx) => {
                const instanceId = ctx.instanceId || "default";
                const server = servers.get(instanceId);
                servers.delete(instanceId);
                pendingServers.delete(instanceId);
                if (server) {
                    await server.close();
                }
            },
        }),
    ],
});
