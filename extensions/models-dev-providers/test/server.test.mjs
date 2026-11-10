import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildCatalog } from "../lib/catalog.mjs";
import { startCanvasServer } from "../lib/server.mjs";
import { rawCatalog, testNow } from "./fixtures.mjs";

const catalog = buildCatalog(rawCatalog, testNow.toISOString());
const catalogResult = {
    providers: catalog.providers,
    counts: catalog.counts,
    fetchedAt: catalog.fetchedAt,
    checkedAt: catalog.fetchedAt,
    stale: false,
    fromCache: true,
    error: null,
};

const APP_SCHEMA = `
create table model_providers (
    id text primary key not null,
    name text not null,
    type text not null default 'openai',
    settings_json text not null default '{}',
    account_id text,
    created_at text,
    updated_at text
);
create table provider_models (
    id text primary key not null,
    provider_id text not null,
    model_id text not null,
    wire_model text,
    display_name text not null,
    max_prompt_tokens integer,
    max_output_tokens integer,
    wire_api_override text,
    supported_reasoning_efforts text,
    supports_vision integer not null default 0,
    created_at text,
    updated_at text,
    unique (provider_id, model_id)
);
`;

function createMockSession() {
    const calls = { add: [], withdraw: [] };
    return {
        calls,
        session: {
            log() {},
            rpc: {
                provider: {
                    add: async (payload) => {
                        calls.add.push(payload);
                        return { models: payload.models || [] };
                    },
                    withdraw: async (payload) => {
                        calls.withdraw.push(payload);
                        return { withdrawn: payload.models || [] };
                    },
                },
                model: { list: async () => ({ list: [] }) },
            },
        },
    };
}

function createAppDatabase(dbPath, withProvider) {
    const db = new DatabaseSync(dbPath);
    db.exec(APP_SCHEMA);
    if (withProvider) {
        db.prepare("insert into model_providers (id, name, type, settings_json) values (?,?,?,?)")
            .run("existing-provider", "Existing", "custom", JSON.stringify({
                baseUrl: "https://existing.example/v1",
                wireApi: "completions",
                authKind: "api_key",
                headersJson: "{}",
            }));
        db.prepare(`insert into provider_models
            (id, provider_id, model_id, display_name, wire_model, supported_reasoning_efforts, supports_vision)
            values (?,?,?,?,?,?,?)`)
            .run("m1", "existing-provider", "existing-model", "Existing Model", "existing-model",
                JSON.stringify(["low", "high"]), 1);
    }
    db.close();
}

test("canvas server lists, adds, updates, and deletes app providers", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "models-dev-app-server-"));
    const appDatabasePath = path.join(temp, "data.db");
    createAppDatabase(appDatabasePath, true);

    const mock = createMockSession();
    const server = await startCanvasServer({
        appDatabasePath,
        backupDir: path.join(temp, "backups"),
        catalogService: { get: async () => catalogResult, refresh: async () => catalogResult },
        session: mock.session,
        preferredPorts: [0],
    });
    const origin = server.origin;
    const tokenPath = new URL(server.url).pathname;
    const urlFor = (route) => new URL(`${tokenPath}${route}`, origin).toString();

    try {
        assert.equal((await fetch(new URL("/", origin))).status, 403);

        const page = await fetch(urlFor(""));
        assert.equal(page.status, 200);
        assert.match(page.headers.get("content-security-policy") || "", /default-src 'none'/);
        assert.match(await page.text(), /Provider Studio/);

        const state = await (await fetch(urlFor("api/state"))).json();
        assert.equal(state.storage, "app");
        assert.equal(state.configured.counts.providers, 1);
        assert.equal(state.configured.providers[0].appId, "existing-provider");
        assert.deepEqual(
            state.configured.models[0].capabilities.supports.reasoning_effort,
            ["low", "high"],
        );

        const wrongType = await fetch(urlFor("api/providers"), {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: "{}",
        });
        assert.equal(wrongType.status, 415);

        const added = await fetch(urlFor("api/providers"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: {
                    name: "Xiaomi Token Plan",
                    type: "openai",
                    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
                    wireApi: "completions",
                    auth: { mode: "none" },
                },
                catalogProviderId: "deepseek",
                models: [{ id: "deepseek-v4", reasoningEfforts: ["low", "high"] }],
                activate: true,
            }),
        });
        const addedBody = await added.json();
        assert.equal(added.status, 201);
        assert.equal(addedBody.storage, "app");
        assert.equal(addedBody.config.counts.providers, 2);
        assert.deepEqual(
            addedBody.config.models.find((model) => model.id === "deepseek-v4").capabilities.supports.reasoning_effort,
            ["low", "high"],
        );
        assert.equal(mock.calls.add.length, 1);
        assert.equal(mock.calls.add[0].providers[0].name, addedBody.providerId);

        const duplicate = await fetch(urlFor("api/providers"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: {
                    name: "Xiaomi Token Plan",
                    type: "openai",
                    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
                    auth: { mode: "none" },
                },
                catalogProviderId: "deepseek",
                models: [{ id: "deepseek-v4" }],
            }),
        });
        assert.equal(duplicate.status, 409);

        const updated = await fetch(urlFor("api/providers"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                appProviderId: addedBody.providerId,
                provider: {
                    name: "Xiaomi Token Plan",
                    type: "openai",
                    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
                    wireApi: "responses",
                    auth: { mode: "none" },
                },
                catalogProviderId: "deepseek",
                models: [{ id: "deepseek-v4", reasoningEfforts: ["medium"] }],
                activate: false,
            }),
        });
        const updatedBody = await updated.json();
        assert.equal(updated.status, 200);
        assert.equal(updatedBody.config.models.filter((model) => model.provider === "Xiaomi Token Plan").length, 1);
        assert.deepEqual(
            updatedBody.config.models.find((model) => model.id === "deepseek-v4").capabilities.supports.reasoning_effort,
            ["medium"],
        );

        const removed = await fetch(urlFor(`api/providers/${addedBody.providerId}`), { method: "DELETE" });
        assert.equal(removed.status, 200);
        const afterRemove = await (await fetch(urlFor("api/state"))).json();
        assert.equal(afterRemove.configured.counts.providers, 1);

        const missing = await fetch(urlFor("api/providers/does-not-exist"), { method: "DELETE" });
        assert.equal(missing.status, 404);
    } finally {
        await server.close();
        await rm(temp, { recursive: true, force: true });
    }
});

test("canvas server reports an unavailable registry instead of writing elsewhere", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "models-dev-no-registry-"));
    const appDatabasePath = path.join(temp, "data.db");

    const server = await startCanvasServer({
        appDatabasePath,
        catalogService: { get: async () => catalogResult, refresh: async () => catalogResult },
        preferredPorts: [0],
    });
    try {
        const state = await (await fetch(`${server.url}api/state`)).json();
        assert.equal(state.configured.appRegistry, false);
        assert.match(state.registryError, /data\.db/);

        const added = await fetch(`${server.url}api/providers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: {
                    name: "Nowhere",
                    type: "openai",
                    baseUrl: "https://nowhere.example/v1",
                    auth: { mode: "none" },
                },
                catalogProviderId: "deepseek",
                models: [{ id: "deepseek-v4" }],
            }),
        });
        assert.equal(added.status, 503);
        const body = await added.json();
        assert.equal(body.error.code, "app_registry_unavailable");
    } finally {
        await server.close();
        await rm(temp, { recursive: true, force: true });
    }
});
