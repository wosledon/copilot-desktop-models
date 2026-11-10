import assert from "node:assert/strict";
import test from "node:test";
import { registerProviderLive, unregisterProviderLive } from "../lib/live.mjs";

function sessionWith(add) {
    const calls = { add: [], withdraw: [] };
    return {
        calls,
        session: {
            rpc: {
                provider: {
                    add: async (payload) => {
                        calls.add.push(payload);
                        return add(payload, calls);
                    },
                    withdraw: async (payload) => {
                        calls.withdraw.push(payload);
                        return { withdrawn: payload.models || [] };
                    },
                },
            },
        },
    };
}

test("registerProviderLive sends the provider and its models", async () => {
    const { calls, session } = sessionWith(async () => ({ models: [] }));
    const result = await registerProviderLive(
        session,
        {
            name: "provider-id",
            type: "openai",
            baseUrl: "https://example.com/v1",
            wireApi: "completions",
            modelProvider: "openai",
            apiKey: "sk-test",
        },
        [
            {
                id: "model-1",
                provider: "provider-id",
                wireModel: "deployment",
                maxPromptTokens: 1000,
                maxOutputTokens: 200,
                capabilities: { supports: { reasoning_effort: ["low", "high"] } },
            },
        ],
    );

    assert.equal(result.ok, true);
    assert.equal(calls.add.length, 1);
    assert.equal(calls.add[0].providers[0].name, "provider-id");
    assert.equal(calls.add[0].providers[0].apiKey, "sk-test");
    assert.deepEqual(calls.add[0].models[0].capabilities.supports.reasoning_effort, ["low", "high"]);
});

test("registerProviderLive withdraws replaced models first", async () => {
    const { calls, session } = sessionWith(async () => ({ models: [] }));
    await registerProviderLive(
        session,
        { name: "provider-id", type: "openai", baseUrl: "https://example.com/v1" },
        [{ id: "model-2", provider: "provider-id" }],
        { previousModelIds: ["model-1"] },
    );

    assert.deepEqual(calls.withdraw[0].models, ["provider-id/model-1"]);
    assert.equal(calls.add.length, 1);
});

test("registerProviderLive redacts credentials from errors", async () => {
    const { session } = sessionWith(async () => {
        throw new Error("rejected key sk-secret-value");
    });
    const result = await registerProviderLive(
        session,
        { name: "p", type: "openai", baseUrl: "https://example.com/v1", apiKey: "sk-secret-value" },
        [{ id: "m", provider: "p" }],
    );
    assert.equal(result.ok, false);
    assert.equal(result.message.includes("sk-secret-value"), false);
    assert.match(result.message, /\[redacted\]/);
});

test("registerProviderLive and unregisterProviderLive skip without the API", async () => {
    const registered = await registerProviderLive(null, { name: "p" }, [{ id: "m" }]);
    assert.equal(registered.skipped, true);
    const removed = await unregisterProviderLive(null, "p", ["m"]);
    assert.equal(removed.skipped, true);
});

test("unregisterProviderLive withdraws a provider", async () => {
    const { calls, session } = sessionWith(async () => ({ models: [] }));
    const result = await unregisterProviderLive(session, "provider-id", ["model-1", "model-2"]);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.withdraw[0].models, ["provider-id/model-1", "provider-id/model-2"]);
});
