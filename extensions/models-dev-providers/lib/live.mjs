import { publicError } from "./util.mjs";

function redact(message, provider) {
    let result = String(message || "The provider could not be registered.");
    for (const secret of [provider?.apiKey, provider?.bearerToken]) {
        if (typeof secret === "string" && secret.length >= 4) {
            result = result.split(secret).join("[redacted]");
        }
    }
    return result.slice(0, 400);
}

function hasProviderApi(session) {
    return Boolean(session?.rpc?.provider?.add && session?.rpc?.provider?.withdraw);
}

function providerPayload(provider) {
    const payload = {
        name: provider.name,
        type: provider.type || "openai",
        baseUrl: provider.baseUrl,
    };
    for (const key of ["apiKey", "bearerToken", "wireApi", "transport", "modelProvider", "azure", "headers"]) {
        if (provider[key] !== undefined && provider[key] !== null) payload[key] = provider[key];
    }
    return payload;
}

function modelPayload(model) {
    const payload = {
        id: model.id,
        provider: model.provider,
    };
    for (const key of ["wireModel", "modelId", "name"]) {
        if (typeof model[key] === "string" && model[key]) payload[key] = model[key];
    }
    for (const key of ["maxPromptTokens", "maxContextWindowTokens", "maxOutputTokens"]) {
        if (Number.isInteger(model[key]) && model[key] > 0) payload[key] = model[key];
    }
    if (model.capabilities && typeof model.capabilities === "object") {
        payload.capabilities = structuredClone(model.capabilities);
    }
    return payload;
}

async function withdraw(session, providerName, modelIds) {
    if (!modelIds.length) return { ok: true, withdrawn: [] };
    try {
        const result = await session.rpc.provider.withdraw({
            models: modelIds.map((id) => `${providerName}/${id}`),
        });
        return { ok: true, withdrawn: result?.withdrawn || [] };
    } catch (error) {
        return { ok: false, error: publicError(error) };
    }
}

/**
 * Registers a provider in the foreground session so it can be used before the
 * next session starts. Failure is non-fatal: the app registry write still holds.
 */
export async function registerProviderLive(session, provider, models, { previousModelIds = [] } = {}) {
    if (!hasProviderApi(session)) {
        return {
            ok: false,
            skipped: true,
            message: "Saved. The live session does not expose provider registration.",
        };
    }

    if (previousModelIds.length) {
        await withdraw(session, provider.name, previousModelIds);
    }

    try {
        await session.rpc.provider.add({
            providers: [providerPayload(provider)],
            models: models.map(modelPayload),
        });
        return { ok: true, message: "Saved and registered in this session." };
    } catch (error) {
        return {
            ok: false,
            message: `Saved, but this session could not register the provider: ${redact(publicError(error), provider)}`,
        };
    }
}

/** Removes a provider's models from the foreground session's runtime registry. */
export async function unregisterProviderLive(session, providerName, modelIds) {
    if (!hasProviderApi(session)) {
        return { ok: false, skipped: true, message: "Removed from the app registry." };
    }
    const result = await withdraw(session, providerName, modelIds);
    if (!result.ok) {
        return {
            ok: false,
            message: `Removed from the app registry, but this session could not unregister it: ${result.error}`,
        };
    }
    return { ok: true, message: "Removed from the app registry and this session." };
}
