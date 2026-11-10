import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../lib/catalog.mjs";
import { ConfigError, normalizeReasoningLevels, prepareModels, resolvePaths } from "../lib/config.mjs";
import { rawCatalog, testNow } from "./fixtures.mjs";

const catalog = buildCatalog(rawCatalog, testNow.toISOString());
const openaiCatalog = catalog.providers.find((provider) => provider.id === "openai");

test("resolvePaths uses COPILOT_HOME for the app database", () => {
    const home = resolvePaths({ COPILOT_HOME: "C:\\custom-home" }, "C:\\Users\\test");
    assert.equal(home.appDatabasePath.endsWith("data.db"), true);
    assert.equal(home.appDatabasePath.startsWith("C:\\custom-home"), true);

    const fallback = resolvePaths({}, "C:\\Users\\test");
    assert.equal(fallback.appDatabasePath, "C:\\Users\\test\\.copilot\\data.db");
});

test("normalizeReasoningLevels keeps known levels in canonical order", () => {
    assert.deepEqual(normalizeReasoningLevels(["high", "low", "bogus"]), ["low", "high"]);
    assert.deepEqual(normalizeReasoningLevels([]), []);
    assert.deepEqual(normalizeReasoningLevels(null), []);
});

test("prepareModels builds entries from the catalog", () => {
    const models = prepareModels({
        providerName: "provider",
        selected: [{ id: "gpt-5.4" }],
        catalogProvider: openaiCatalog,
    });

    assert.equal(models.length, 1);
    assert.equal(models[0].id, "gpt-5.4");
    assert.equal(models[0].provider, "provider");
    assert.deepEqual(models[0].capabilities.supports.reasoning_effort, ["low", "medium", "high"]);
});

test("prepareModels applies explicit effort levels and rejects unknown ones", () => {
    const models = prepareModels({
        providerName: "provider",
        selected: [{ id: "gpt-5.4", reasoningEfforts: ["high", "low"] }],
        catalogProvider: openaiCatalog,
    });
    assert.deepEqual(models[0].capabilities.supports.reasoning_effort, ["low", "high"]);

    assert.throws(() => prepareModels({
        providerName: "provider",
        selected: [{ id: "gpt-5.4", reasoningEfforts: ["ultra"] }],
        catalogProvider: openaiCatalog,
    }), (error) => error instanceof ConfigError && /reasoning effort level/.test(error.message));
});

test("prepareModels rejects models outside the catalog", () => {
    assert.throws(() => prepareModels({
        providerName: "provider",
        selected: [{ id: "not-in-catalog" }],
        catalogProvider: openaiCatalog,
    }), /not in the current models\.dev catalog/);
});

test("prepareModels keeps existing entries and their manual edits", () => {
    const models = prepareModels({
        providerName: "provider",
        selected: [{ id: "gpt-5.4" }],
        existingModels: [{
            id: "gpt-5.4",
            provider: "provider",
            name: "Custom Name",
            wireModel: "deployment",
            capabilities: { supports: { reasoning_effort: ["medium"], vision: true } },
        }],
        catalogProvider: openaiCatalog,
    });

    assert.equal(models[0].name, "Custom Name");
    assert.equal(models[0].wireModel, "deployment");
    assert.deepEqual(models[0].capabilities.supports.reasoning_effort, ["medium"]);
});
