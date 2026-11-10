import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    buildCatalog,
    buildProviderModel,
    CatalogService,
    classifyProvider,
    isChatModel,
    summarizeModel,
} from "../lib/catalog.mjs";
import { rawCatalog, testNow } from "./fixtures.mjs";

test("classifies supported and unsupported providers", () => {
    const openai = classifyProvider("openai", rawCatalog.openai);
    assert.equal(openai.compatibility, "native");
    assert.equal(openai.type, "openai");
    assert.equal(openai.baseUrl, "https://api.openai.com/v1");
    assert.equal(openai.wireApi, "responses");

    const anthropic = classifyProvider("anthropic", rawCatalog.anthropic);
    assert.equal(anthropic.type, "anthropic");
    assert.equal(anthropic.baseUrl, "https://api.anthropic.com");
    assert.equal(anthropic.wireApi, null);

    const azure = classifyProvider("azure-cognitive-services", rawCatalog["azure-cognitive-services"]);
    assert.equal(azure.type, "azure");
    assert.equal(azure.requiresBaseUrl, true);

    const deepseek = classifyProvider("deepseek", rawCatalog.deepseek);
    assert.equal(deepseek.compatibility, "native");
    assert.equal(deepseek.baseUrl, "https://api.deepseek.com");

    const openrouter = classifyProvider("openrouter", rawCatalog.openrouter);
    assert.equal(openrouter.compatibility, "compatible");
    assert.equal(openrouter.type, "openai");

    const custom = classifyProvider("custom", rawCatalog.custom);
    assert.equal(custom.compatibility, "experimental");
    assert.equal(custom.baseUrl, "https://custom.example/v1");

    const manual = classifyProvider("manual", rawCatalog.manual);
    assert.equal(manual.compatibility, "manual");
    assert.equal(manual.requiresBaseUrl, true);

    const builtin = classifyProvider("github-copilot", rawCatalog["github-copilot"]);
    assert.equal(builtin.compatibility, "builtin");
    assert.equal(builtin.type, null);
});

test("buildCatalog filters non-chat models and publishes safe metadata", () => {
    const catalog = buildCatalog(rawCatalog, testNow.toISOString());
    assert.equal(catalog.counts.providers, 8);
    assert.equal(catalog.counts.models, 9);
    assert.equal(catalog.providers.some((provider) => provider.id === "images-only"), false);

    const openai = catalog.providers.find((provider) => provider.id === "openai");
    assert.equal(openai.modelCount, 2);
    assert.equal(openai.models.some((model) => model.id === "text-embedding-4"), false);
    assert.equal(openai.models[0].id, "gpt-5.4");
    assert.equal(openai.models[0].vision, true);
    assert.equal(openai.models[0].toolCalls, true);
    assert.equal(openai.models[0].reasoningEffort, true);
    assert.equal(openai.models[0].context, 400000);

    const custom = catalog.providers.find((provider) => provider.id === "custom");
    assert.equal(custom.compatibility, "experimental");
    assert.equal(custom.baseUrl, "https://custom.example/v1");

    const builtin = catalog.providers.find((provider) => provider.id === "github-copilot");
    assert.equal(builtin.compatibility, "builtin");
});

test("isChatModel and summarizeModel handle edge cases", () => {
    assert.equal(isChatModel({ id: "embed", type: "embedding", modalities: { output: ["text"] } }), false);
    assert.equal(isChatModel({ id: "image", type: "image", modalities: { output: ["image"] } }), false);
    assert.equal(isChatModel({ id: "audio-chat", modalities: { output: ["text", "audio"] } }), true);
    assert.equal(isChatModel({ id: "", modalities: { output: ["text"] } }), false);

    const summary = summarizeModel(rawCatalog.anthropic.models["claude-sonnet-4.5"]);
    assert.equal(summary.vision, true);
    assert.equal(summary.pdf, true);
    assert.equal(summary.reasoningEffort, true);
    assert.equal(summary.input, 136000);
    assert.equal(summary.output, 64000);

    const deepseek = summarizeModel(rawCatalog.deepseek.models["deepseek-v4"]);
    assert.equal(deepseek.reasoningEffort, true);
    assert.equal(deepseek.output, 128000);
});

test("buildProviderModel writes limits, capabilities, and source metadata", () => {
    const catalog = buildCatalog(rawCatalog, testNow.toISOString());
    const provider = catalog.providers.find((entry) => entry.id === "openai");
    const model = provider.models.find((entry) => entry.id === "gpt-5.4");

    const built = buildProviderModel(provider, model, "openai-work", { wireModel: "deployment-gpt-5.4" });
    assert.equal(built.id, "gpt-5.4");
    assert.equal(built.provider, "openai-work");
    assert.equal(built.modelId, "gpt-5.4");
    assert.equal(built.wireModel, "deployment-gpt-5.4");
    assert.equal(built.maxContextWindowTokens, 400000);
    assert.equal(built.maxPromptTokens, 272000);
    assert.equal(built.maxOutputTokens, 128000);
    assert.equal(built.capabilities.family, "gpt");
    assert.equal(built.capabilities.supports.vision, true);
    assert.equal(built.capabilities.supports.toolCalls, true);
    assert.equal(built.capabilities.supports.thinking, true);
    assert.deepEqual(built.capabilities.supports.reasoning_effort, ["low", "medium", "high"]);
    assert.equal(built.metadata.modelsDev.provider, "openai");
    assert.equal(built.metadata.modelsDev.canonicalModelId, "openai/gpt-5.4");
});

test("CatalogService caches, revalidates, and falls back to stale data", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "models-dev-catalog-"));
    const cachePath = path.join(temp, "cache", "catalog.json");
    let current = new Date(testNow);
    let mode = "ok";
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        if (mode === "throw") throw new Error("offline");
        if (mode === "304") {
            return new Response(null, { status: 304, headers: { etag: '"fixture-1"' } });
        }
        return new Response(JSON.stringify(rawCatalog), {
            status: 200,
            headers: { "content-type": "application/json", etag: '"fixture-1"' },
        });
    };

    try {
        const service = new CatalogService({
            cachePath,
            fetchImpl,
            ttlMs: 60_000,
            now: () => current,
        });

        const first = await service.get();
        assert.equal(first.providers.length, 8);
        assert.equal(first.fromCache, false);
        assert.equal(first.error, null);
        assert.equal(calls, 1);

        const cached = await service.get();
        assert.equal(cached.fromCache, true);
        assert.equal(calls, 1);

        const stored = JSON.parse(await readFile(cachePath, "utf8"));
        assert.equal(stored.version, 2);
        assert.equal(stored.providers.length, 8);
        assert.equal(stored.etag, '"fixture-1"');

        const freshService = new CatalogService({
            cachePath,
            fetchImpl,
            ttlMs: 60_000,
            now: () => current,
        });
        const fromDisk = await freshService.get();
        assert.equal(fromDisk.providers.length, 8);
        assert.equal(fromDisk.fromCache, true);
        assert.equal(calls, 1);

        current = new Date(Date.parse(testNow.toISOString()) + 120_000);
        mode = "304";
        const revalidated = await freshService.get({ force: true });
        assert.equal(revalidated.fromCache, true);
        assert.equal(revalidated.stale, false);
        assert.equal(calls, 2);

        current = new Date(Date.parse(testNow.toISOString()) + 240_000);
        mode = "throw";
        const stale = await freshService.get();
        assert.equal(stale.stale, true);
        assert.equal(stale.providers.length, 8);
        assert.match(stale.error, /models\.dev/i);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});

test("buildProviderModel defaults reasoning levels when the catalog cache is old", () => {
    const provider = { id: "xiaomi-token-plan-cn", name: "Xiaomi" };
    const staleModel = {
        id: "mimo-v2.6-flash",
        name: "MiMo-V2.6-Flash",
        reasoning: true,
        toolCalls: true,
        vision: true,
        context: 1048576,
        output: 131072,
    };

    const built = buildProviderModel(provider, staleModel, "xiaomi-token-plan-cn");
    assert.deepEqual(built.capabilities.supports.reasoning_effort, ["low", "medium", "high"]);
    assert.equal(built.capabilities.supports.thinking, true);
});

test("old catalog caches are discarded after a format change", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "models-dev-cache-version-"));
    const cachePath = path.join(temp, "catalog.json");
    let calls = 0;
    try {
        await writeFile(cachePath, JSON.stringify({
            version: 1,
            fetchedAt: testNow.toISOString(),
            checkedAt: testNow.toISOString(),
            counts: { providers: 1, models: 1 },
            providers: [{ id: "stale", name: "Stale", models: [{ id: "old-model" }] }],
        }), "utf8");

        const service = new CatalogService({
            cachePath,
            now: () => new Date(testNow),
            fetchImpl: async () => {
                calls += 1;
                return new Response(JSON.stringify(rawCatalog), { status: 200 });
            },
        });

        const result = await service.get();
        assert.equal(calls, 1);
        assert.equal(result.fromCache, false);
        assert.equal(result.providers.some((provider) => provider.id === "stale"), false);
        const stored = JSON.parse(await readFile(cachePath, "utf8"));
        assert.equal(stored.version, 2);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});

test("CatalogService reports an error when there is no cache", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "models-dev-catalog-offline-"));
    try {
        const service = new CatalogService({
            cachePath: path.join(temp, "catalog.json"),
            fetchImpl: async () => {
                throw new Error("network down");
            },
            now: () => new Date(testNow),
        });
        const result = await service.get();
        assert.equal(result.providers.length, 0);
        assert.equal(result.stale, true);
        assert.match(result.error, /network down/i);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});
