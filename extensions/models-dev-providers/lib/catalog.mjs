import { readFile } from "node:fs/promises";
import { tokenLimit, normalizeBaseUrl, safeWebUrl, writeJsonAtomic, publicError } from "./util.mjs";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const CATALOG_CACHE_VERSION = 2;
export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

const OPENAI_NPMS = new Set(["@ai-sdk/openai", "@ai-sdk/openai-compatible"]);
const ANTHROPIC_NPMS = new Set(["@ai-sdk/anthropic"]);
const AZURE_NPMS = new Set(["@ai-sdk/azure"]);

// Popular providers whose published protocol is OpenAI-compatible even though
// models.dev points at a provider-specific SDK package. A catalog `api` value
// always wins over these defaults.
const KNOWN_OPENAI_COMPATIBLE = Object.freeze({
    openrouter: "https://openrouter.ai/api/v1",
    groq: "https://api.groq.com/openai/v1",
    xai: "https://api.x.ai/v1",
    mistral: "https://api.mistral.ai/v1",
    cerebras: "https://api.cerebras.ai/v1",
    togetherai: "https://api.together.xyz/v1",
    deepinfra: "https://api.deepinfra.com/v1/openai",
    cohere: "https://api.cohere.ai/compatibility/v1",
    perplexity: "https://api.perplexity.ai",
    vercel: "https://ai-gateway.vercel.sh/v1",
    aihubmix: "https://aihubmix.com/v1",
});

const EXCLUDED_MODEL_TYPES = new Set([
    "embedding",
    "image",
    "reranking",
    "realtime",
    "speech",
    "transcription",
    "video",
]);

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function stringList(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
}

function modelProviderLabel(providerId, type) {
    if (type === "anthropic") return "anthropic";
    if (type === "azure") return "azure_openai";
    if (providerId === "ollama") return "ollama";
    if (providerId === "lmstudio") return "lm_studio";
    if (providerId === "foundry-local" || providerId === "foundrylocal") return "foundry_local";
    return "openai";
}

/**
 * Classifies a models.dev provider into the provider types Copilot supports.
 * Unknown providers remain addable when they publish an endpoint; Copilot will
 * treat those as OpenAI-compatible and the UI marks them as experimental.
 */
export function classifyProvider(providerId, raw = {}) {
    const npm = typeof raw.npm === "string" ? raw.npm : "";
    const publishedUrl = normalizeBaseUrl(raw.api, ANTHROPIC_NPMS.has(npm) ? "anthropic" : "openai");

    if (providerId === "github-copilot") {
        return {
            compatibility: "builtin",
            type: null,
            baseUrl: null,
            wireApi: null,
            requiresBaseUrl: false,
            modelProvider: "openai",
            note: "These models are already available through Copilot.",
        };
    }

    if (ANTHROPIC_NPMS.has(npm)) {
        const baseUrl = publishedUrl || (providerId === "anthropic" ? "https://api.anthropic.com" : null);
        return {
            compatibility: "native",
            type: "anthropic",
            baseUrl,
            wireApi: null,
            requiresBaseUrl: !baseUrl,
            modelProvider: "anthropic",
            note: baseUrl ? null : "Enter the provider's Anthropic-compatible base URL.",
        };
    }

    if (AZURE_NPMS.has(npm)) {
        return {
            compatibility: "native",
            type: "azure",
            baseUrl: publishedUrl || null,
            wireApi: "completions",
            requiresBaseUrl: !publishedUrl,
            modelProvider: "azure_openai",
            note: "Enter your Azure resource or project endpoint.",
        };
    }

    if (OPENAI_NPMS.has(npm)) {
        const baseUrl = publishedUrl || (providerId === "openai" ? "https://api.openai.com/v1" : null);
        return {
            compatibility: "native",
            type: "openai",
            baseUrl,
            wireApi: providerId === "openai" ? "responses" : "completions",
            requiresBaseUrl: !baseUrl,
            modelProvider: modelProviderLabel(providerId, "openai"),
            note: baseUrl ? null : "Enter the provider's OpenAI-compatible base URL.",
        };
    }

    if (Object.hasOwn(KNOWN_OPENAI_COMPATIBLE, providerId)) {
        return {
            compatibility: "compatible",
            type: "openai",
            baseUrl: publishedUrl || KNOWN_OPENAI_COMPATIBLE[providerId],
            wireApi: "completions",
            requiresBaseUrl: false,
            modelProvider: modelProviderLabel(providerId, "openai"),
            note: "Uses the provider's OpenAI-compatible API.",
        };
    }

    if (publishedUrl) {
        return {
            compatibility: "experimental",
            type: "openai",
            baseUrl: publishedUrl,
            wireApi: "completions",
            requiresBaseUrl: false,
            modelProvider: modelProviderLabel(providerId, "openai"),
            note: "This provider uses a custom SDK. Copilot will try its published endpoint as OpenAI-compatible.",
        };
    }

    return {
        compatibility: "manual",
        type: "openai",
        baseUrl: null,
        wireApi: "completions",
        requiresBaseUrl: true,
        modelProvider: modelProviderLabel(providerId, "openai"),
        note: "No API endpoint is published. Enter an OpenAI-compatible base URL.",
    };
}

export function isChatModel(model) {
    if (!model || typeof model !== "object" || typeof model.id !== "string" || !model.id.trim()) return false;
    if (typeof model.type === "string" && EXCLUDED_MODEL_TYPES.has(model.type)) return false;
    const output = stringList(model.modalities?.output);
    return output.length === 0 || output.includes("text");
}

export const REASONING_LEVELS = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Reasoning-effort levels advertised by models.dev, or a safe default. */
export function catalogReasoningLevels(model) {
    const options = Array.isArray(model?.reasoning_options) ? model.reasoning_options : [];
    const effortOption = options.find((option) => option && option.type === "effort");
    const values = Array.isArray(effortOption?.values)
        ? effortOption.values.filter((value) => typeof value === "string" && value.length > 0)
        : [];
    if (values.length) return values;
    if (Array.isArray(model?.efforts) && model.efforts.length) return [...model.efforts];
    return model?.reasoning === true ? ["low", "medium", "high"] : [];
}

/** Converts a models.dev model to the small shape the browser needs. */
export function summarizeModel(model) {
    const inputs = stringList(model.modalities?.input);
    const reasoningOptions = Array.isArray(model.reasoning_options) ? model.reasoning_options : [];
    const reasoningEffort = model.reasoning === true || reasoningOptions.some((option) =>
        option && (option.type === "effort" || option.type === "budget_tokens"));
    const context = tokenLimit(model.limit?.context);
    const output = tokenLimit(model.limit?.output);
    const input = tokenLimit(model.limit?.input)
        || (context && output ? Math.max(1, context - output) : context);

    return {
        id: model.id,
        name: typeof model.name === "string" && model.name ? model.name : model.id,
        family: typeof model.family === "string" ? model.family : null,
        description: typeof model.description === "string" ? model.description.slice(0, 220) : null,
        toolCalls: model.tool_call === true,
        reasoning: model.reasoning === true,
        reasoningEffort,
        efforts: catalogReasoningLevels(model),
        vision: inputs.includes("image"),
        pdf: inputs.includes("pdf"),
        context,
        input,
        output,
        releaseDate: typeof model.release_date === "string" ? model.release_date : null,
        lastUpdated: typeof model.last_updated === "string" ? model.last_updated : null,
        status: typeof model.status === "string" ? model.status : null,
        openWeights: model.open_weights === true,
        canonicalId: typeof model.canonical_model_id === "string" ? model.canonical_model_id : null,
    };
}

export function compareModels(a, b) {
    const dateDiff = (b.releaseDate || "").localeCompare(a.releaseDate || "");
    if (dateDiff) return dateDiff;
    return collator.compare(a.name, b.name);
}

/** Builds the trimmed, browser-safe catalog from the models.dev payload. */
export function buildCatalog(rawCatalog, fetchedAt = new Date().toISOString()) {
    if (!rawCatalog || typeof rawCatalog !== "object" || Array.isArray(rawCatalog)) {
        throw new Error("models.dev returned an unexpected catalog format.");
    }

    const providers = [];
    for (const [providerId, rawProvider] of Object.entries(rawCatalog)) {
        if (!rawProvider || typeof rawProvider !== "object") continue;
        const rawModels = rawProvider.models && typeof rawProvider.models === "object"
            ? Object.values(rawProvider.models)
            : [];
        const models = rawModels
            .filter(isChatModel)
            .map(summarizeModel)
            .sort(compareModels);

        if (models.length === 0) continue;

        const classification = classifyProvider(providerId, rawProvider);
        providers.push({
            id: providerId,
            name: typeof rawProvider.name === "string" && rawProvider.name ? rawProvider.name : providerId,
            doc: safeWebUrl(rawProvider.doc),
            npm: typeof rawProvider.npm === "string" ? rawProvider.npm : null,
            env: stringList(rawProvider.env),
            ...classification,
            modelCount: models.length,
            models,
        });
    }

    providers.sort((a, b) => {
        if (a.compatibility === "builtin" && b.compatibility !== "builtin") return 1;
        if (b.compatibility === "builtin" && a.compatibility !== "builtin") return -1;
        return collator.compare(a.name, b.name);
    });

    return {
        providers,
        counts: {
            providers: providers.length,
            models: providers.reduce((total, provider) => total + provider.modelCount, 0),
        },
        fetchedAt,
    };
}

/**
 * Builds an app-registry model entry from a models.dev catalog model.
 * Existing user edits are merged by the config layer, not here.
 */
export function buildProviderModel(catalogProvider, catalogModel, providerName, { wireModel, reasoningLevels } = {}) {
    const canonical = catalogModel.canonicalId || catalogModel.id;
    const modelId = canonical.split("/").pop() || catalogModel.id;

    const entry = {
        id: catalogModel.id,
        provider: providerName,
        name: catalogModel.name,
        modelId,
    };

    const cleanWireModel = typeof wireModel === "string" ? wireModel.trim() : "";
    if (cleanWireModel && cleanWireModel !== catalogModel.id) entry.wireModel = cleanWireModel;

    if (catalogModel.context) entry.maxContextWindowTokens = catalogModel.context;
    if (catalogModel.input || catalogModel.context) {
        entry.maxPromptTokens = catalogModel.input || catalogModel.context;
    }
    if (catalogModel.output) entry.maxOutputTokens = catalogModel.output;

    const supports = {
        vision: catalogModel.vision === true,
        toolCalls: catalogModel.toolCalls === true,
    };
    if (catalogModel.reasoning) supports.thinking = true;

    const levels = Array.isArray(reasoningLevels)
        ? reasoningLevels
        : (Array.isArray(catalogModel.efforts) && catalogModel.efforts.length
            ? catalogModel.efforts
            : (catalogModel.reasoning ? ["low", "medium", "high"] : []));
    if (levels.length) supports.reasoning_effort = [...levels];

    entry.capabilities = { supports };
    if (catalogModel.family) entry.capabilities.family = catalogModel.family;

    const modelsDev = {
        provider: catalogProvider.id,
        model: catalogModel.id,
    };
    if (catalogModel.canonicalId) modelsDev.canonicalModelId = catalogModel.canonicalId;
    if (catalogModel.releaseDate) modelsDev.releaseDate = catalogModel.releaseDate;
    if (catalogModel.lastUpdated) modelsDev.lastUpdated = catalogModel.lastUpdated;
    if (catalogModel.status) modelsDev.status = catalogModel.status;
    if (catalogModel.openWeights) modelsDev.openWeights = true;
    entry.metadata = { modelsDev };

    return entry;
}

function freshEnough(cache, ttlMs, nowMs) {
    if (!cache?.checkedAt) return false;
    const checkedAt = Date.parse(cache.checkedAt);
    return Number.isFinite(checkedAt) && nowMs - checkedAt < ttlMs;
}

/**
 * Fetches, trims, and caches models.dev. Network failure falls back to the
 * newest cached copy and reports the error separately.
 */
export class CatalogService {
    constructor({
        url = MODELS_DEV_URL,
        cachePath,
        fetchImpl = globalThis.fetch,
        ttlMs = DEFAULT_CACHE_TTL_MS,
        now = () => new Date(),
        logger = null,
    } = {}) {
        if (!cachePath) throw new Error("CatalogService requires a cachePath.");
        if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
        this.url = url;
        this.cachePath = cachePath;
        this.fetchImpl = fetchImpl;
        this.ttlMs = ttlMs;
        this.now = now;
        this.logger = logger;
        this.memory = null;
        this.inflight = null;
    }

    async get({ force = false } = {}) {
        const now = this.now();
        if (!force && this.memory && freshEnough(this.memory, this.ttlMs, now.getTime())) {
            return { ...this.memory, stale: false, fromCache: true, error: null };
        }
        if (this.inflight) return this.inflight;

        this.inflight = this.#load({ force, now }).finally(() => {
            this.inflight = null;
        });
        return this.inflight;
    }

    async refresh() {
        return this.get({ force: true });
    }

    async #load({ force, now }) {
        const cached = await this.#readCache().catch(() => null);
        if (!force && cached && freshEnough(cached, this.ttlMs, now.getTime())) {
            this.memory = cached;
            return { ...cached, stale: false, fromCache: true, error: null };
        }

        try {
            const headers = {
                Accept: "application/json",
                "User-Agent": "copilot-desktop-models/1.0",
            };
            if (cached?.etag) headers["If-None-Match"] = cached.etag;

            const signal = typeof globalThis.AbortSignal?.timeout === "function" ? AbortSignal.timeout(30_000) : undefined;
            const response = await this.fetchImpl(this.url, { headers, signal });

            if (response.status === 304 && cached) {
                const refreshed = {
                    ...cached,
                    checkedAt: now.toISOString(),
                };
                this.memory = refreshed;
                await this.#writeCache(refreshed);
                return { ...refreshed, stale: false, fromCache: true, error: null };
            }

            if (!response.ok) {
                throw new Error(`models.dev returned HTTP ${response.status}.`);
            }

            const declaredLength = Number(response.headers?.get?.("content-length") || 0);
            if (declaredLength > MAX_RESPONSE_BYTES) {
                throw new Error("The models.dev catalog is larger than the supported limit.");
            }

            const text = await response.text();
            if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
                throw new Error("The models.dev catalog is larger than the supported limit.");
            }

            const raw = JSON.parse(text);
            const catalog = buildCatalog(raw, now.toISOString());
            const cache = {
                version: CATALOG_CACHE_VERSION,
                fetchedAt: catalog.fetchedAt,
                checkedAt: now.toISOString(),
                etag: response.headers?.get?.("etag") || null,
                counts: catalog.counts,
                providers: catalog.providers,
            };
            this.memory = cache;
            await this.#writeCache(cache);
            return {
                providers: catalog.providers,
                counts: catalog.counts,
                fetchedAt: cache.fetchedAt,
                checkedAt: cache.checkedAt,
                stale: false,
                fromCache: false,
                error: null,
            };
        } catch (error) {
            const fallback = this.memory || cached;
            const message = this.#networkError(error);
            this.logger?.warn?.(`models.dev catalog refresh failed: ${publicError(error)}`);
            if (fallback) {
                this.memory = fallback;
                return {
                    providers: fallback.providers,
                    counts: fallback.counts,
                    fetchedAt: fallback.fetchedAt,
                    checkedAt: fallback.checkedAt,
                    stale: true,
                    fromCache: true,
                    error: message,
                };
            }
            return {
                providers: [],
                counts: { providers: 0, models: 0 },
                fetchedAt: null,
                checkedAt: null,
                stale: true,
                fromCache: false,
                error: message,
            };
        }
    }

    #networkError(error) {
        const detail = publicError(error, "models.dev could not be reached.");
        if (/HTTP \d+/.test(detail)) return detail;
        return `Could not reach models.dev. Check your network connection and retry. (${detail})`;
    }

    async #readCache() {
        let text;
        try {
            text = await readFile(this.cachePath, "utf8");
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
        }
        const cache = JSON.parse(text);
        if (cache?.version !== CATALOG_CACHE_VERSION || !Array.isArray(cache.providers)) return null;
        return cache;
    }

    async #writeCache(cache) {
        try {
            await writeJsonAtomic(this.cachePath, cache, { pretty: false });
        } catch (error) {
            this.logger?.warn?.(`Could not cache the models.dev catalog: ${publicError(error)}`);
        }
    }
}
