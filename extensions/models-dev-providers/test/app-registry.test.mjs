import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
    deleteAppProvider,
    readAppRegistry,
    upsertAppProvider,
} from "../lib/app-registry.mjs";

const SCHEMA = `
create table model_providers (
    id text primary key not null,
    name text not null,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    type text not null default 'openai',
    settings_json text not null default '{}',
    account_id text
);
create table provider_models (
    id text primary key not null,
    provider_id text not null references model_providers(id) on delete cascade,
    model_id text not null,
    wire_model text,
    display_name text not null,
    max_prompt_tokens integer,
    max_output_tokens integer,
    wire_api_override text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    supported_reasoning_efforts text,
    supports_vision integer not null default 0,
    unique (provider_id, model_id)
);
`;

async function makeDatabase() {
    const temp = await mkdtemp(path.join(os.tmpdir(), "models-dev-app-registry-"));
    const dbPath = path.join(temp, "data.db");
    const db = new DatabaseSync(dbPath);
    db.exec(SCHEMA);
    db.close();
    return { temp, dbPath };
}

test("reads, upserts, and deletes app providers", async () => {
    const { temp, dbPath } = await makeDatabase();
    try {
        const empty = await readAppRegistry(dbPath);
        assert.equal(empty.available, true);
        assert.deepEqual(empty.providers, []);

        const created = await upsertAppProvider(dbPath, {
            name: "Xiaomi Token Plan",
            type: "custom",
            baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
            wireApi: "completions",
            authKind: "api_key",
        }, [
            {
                id: "mimo-v2.6-flash",
                name: "MiMo-V2.6-Flash",
                wireModel: "mimo-v2.6-flash",
                maxPromptTokens: 917504,
                maxOutputTokens: 131072,
                reasoningEfforts: ["low", "medium", "high"],
                vision: true,
            },
        ], { backupDir: path.join(temp, "backups") });

        assert.ok(created.id);

        const registry = await readAppRegistry(dbPath);
        assert.equal(registry.providers.length, 1);
        const [provider] = registry.providers;
        assert.equal(provider.name, "Xiaomi Token Plan");
        assert.equal(provider.baseUrl, "https://token-plan-cn.xiaomimimo.com/v1");
        assert.equal(provider.authKind, "api_key");
        assert.equal(provider.models.length, 1);
        assert.deepEqual(provider.models[0].efforts, ["low", "medium", "high"]);
        assert.equal(provider.models[0].vision, true);
        assert.equal(provider.models[0].maxPromptTokens, 917504);

        const updated = await upsertAppProvider(dbPath, {
            appId: created.id,
            name: "Xiaomi",
            type: "custom",
            baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
            wireApi: "responses",
            authKind: "bearer_token",
        }, [
            {
                id: "mimo-v2.6-pro",
                name: "MiMo-V2.6-Pro",
                wireModel: "mimo-deployment",
                maxPromptTokens: 1000,
                maxOutputTokens: 200,
                reasoningEfforts: ["high"],
                vision: false,
            },
        ], { backupDir: path.join(temp, "backups") });

        assert.equal(updated.id, created.id);

        const after = await readAppRegistry(dbPath);
        assert.equal(after.providers.length, 1);
        assert.equal(after.providers[0].name, "Xiaomi");
        assert.equal(after.providers[0].wireApi, "responses");
        assert.equal(after.providers[0].authKind, "bearer_token");
        assert.equal(after.providers[0].models.length, 1);
        assert.equal(after.providers[0].models[0].id, "mimo-v2.6-pro");
        assert.equal(after.providers[0].models[0].wireModel, "mimo-deployment");
        assert.deepEqual(after.providers[0].models[0].efforts, ["high"]);

        const deleted = await deleteAppProvider(dbPath, created.id);
        assert.equal(deleted.deleted, true);
        const finalState = await readAppRegistry(dbPath);
        assert.deepEqual(finalState.providers, []);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});

test("github copilot rows are ignored", async () => {
    const { temp, dbPath } = await makeDatabase();
    try {
        const db = new DatabaseSync(dbPath);
        db.prepare("insert into model_providers (id, name, type, settings_json) values (?,?,?,?)")
            .run("github_copilot:1", "GitHub Copilot", "github_copilot", "{}");
        db.prepare("insert into provider_models (id, provider_id, model_id, display_name) values (?,?,?,?)")
            .run("m1", "github_copilot:1", "gpt", "GPT");
        db.close();

        const registry = await readAppRegistry(dbPath);
        assert.deepEqual(registry.providers, []);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});

test("missing database reports unavailable", async () => {
    const registry = await readAppRegistry(path.join(os.tmpdir(), "does-not-exist-12345", "data.db"));
    assert.equal(registry.available, false);
    assert.deepEqual(registry.providers, []);
});
