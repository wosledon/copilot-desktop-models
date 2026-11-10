import os from "node:os";
import path from "node:path";
import { buildProviderModel } from "./catalog.mjs";
import { cleanString } from "./util.mjs";

/** Reasoning levels Copilot recognizes, in canonical order. */
export const REASONING_LEVELS = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const LEVEL_SET = new Set(REASONING_LEVELS);

export class ConfigError extends Error {
    constructor(message, { code = "invalid_request", status = 400 } = {}) {
        super(message);
        this.name = "ConfigError";
        this.code = code;
        this.status = status;
    }
}

/** Resolves the Copilot home, app database, cache, and backup locations. */
export function resolvePaths(env = process.env, homeDir = os.homedir()) {
    const copilotHome = env.COPILOT_HOME?.trim()
        ? path.resolve(env.COPILOT_HOME.trim())
        : path.join(homeDir, ".copilot");
    const pluginData = path.join(copilotHome, "plugin-data", "models-dev-providers");

    return {
        copilotHome,
        pluginData,
        appDatabasePath: path.join(copilotHome, "data.db"),
        cachePath: path.join(pluginData, "catalog.json"),
        backupDir: path.join(pluginData, "backups"),
    };
}

/** Filters reasoning levels to the ones Copilot recognizes, in canonical order. */
export function normalizeReasoningLevels(value) {
    if (!Array.isArray(value)) return [];
    return REASONING_LEVELS.filter((level) => value.includes(level));
}

function orderedReasoningLevels(value) {
    if (!Array.isArray(value)) {
        throw new ConfigError("Reasoning effort levels must be an array of strings.");
    }
    const seen = new Set();
    for (const level of value) {
        if (typeof level !== "string" || !LEVEL_SET.has(level)) {
            throw new ConfigError(
                `Unsupported reasoning effort level. Use any of: ${REASONING_LEVELS.join(", ")}.`,
            );
        }
        seen.add(level);
    }
    return REASONING_LEVELS.filter((level) => seen.has(level));
}

function selectedModelEntries(selected) {
    if (!Array.isArray(selected) || selected.length === 0) {
        throw new ConfigError("Select at least one model.");
    }
    if (selected.length > 1000) {
        throw new ConfigError("Select no more than 1000 models for one provider.");
    }

    const entries = [];
    const seen = new Set();
    for (const item of selected) {
        const id = cleanString(typeof item === "string" ? item : item?.id, 256);
        if (!id) throw new ConfigError("Every selected model needs a valid ID.");
        if (seen.has(id)) continue;
        seen.add(id);

        let hasWireModel = false;
        let wireModel;
        if (typeof item === "object" && item !== null && Object.hasOwn(item, "wireModel")) {
            if (typeof item.wireModel !== "string") {
                throw new ConfigError("A wire model name must be text.");
            }
            wireModel = item.wireModel.trim();
            if (wireModel.length > 256 || /[\u0000-\u001f\u007f]/.test(wireModel)) {
                throw new ConfigError("A wire model name contains unsupported characters.");
            }
            hasWireModel = true;
        }

        let hasEfforts = false;
        let reasoningEfforts;
        if (typeof item === "object" && item !== null && Object.hasOwn(item, "reasoningEfforts")) {
            reasoningEfforts = orderedReasoningLevels(item.reasoningEfforts);
            hasEfforts = true;
        }

        entries.push({ id, wireModel, hasWireModel, reasoningEfforts, hasEfforts });
    }
    if (!entries.length) throw new ConfigError("Select at least one model.");
    return entries;
}

function normalizeCapabilities(capabilities, { reasoningEfforts, hasEfforts } = {}) {
    const next = capabilities && typeof capabilities === "object" ? { ...capabilities } : undefined;
    if (!next) {
        if (!hasEfforts || !reasoningEfforts.length) return undefined;
        return { supports: { reasoning_effort: [...reasoningEfforts] } };
    }

    const supports = next.supports && typeof next.supports === "object" ? { ...next.supports } : {};
    delete supports.reasoningEffort;
    if (hasEfforts) {
        if (reasoningEfforts.length) supports.reasoning_effort = [...reasoningEfforts];
        else delete supports.reasoning_effort;
    } else if (Array.isArray(supports.reasoning_effort)) {
        const clean = supports.reasoning_effort.filter((level) => LEVEL_SET.has(level));
        if (clean.length) supports.reasoning_effort = clean;
        else delete supports.reasoning_effort;
    }

    if (Object.keys(supports).length) next.supports = supports;
    else delete next.supports;
    return Object.keys(next).length ? next : undefined;
}

function hasReasoningLevels(capabilities) {
    return Array.isArray(capabilities?.supports?.reasoning_effort)
        && capabilities.supports.reasoning_effort.length > 0;
}

function mergeExistingModel(existing, providerName, catalogModel, wireModel, hasWireModel, reasoningEfforts, hasEfforts) {
    const merged = {
        ...existing,
        id: existing.id,
        provider: providerName,
    };
    if (!merged.name && catalogModel) merged.name = catalogModel.name;
    if (hasWireModel) {
        if (wireModel) merged.wireModel = wireModel;
        else delete merged.wireModel;
    }

    const catalogLevels = Array.isArray(catalogModel?.efforts) ? catalogModel.efforts : [];
    const fallback = !hasEfforts && !hasReasoningLevels(merged.capabilities) && catalogLevels.length
        ? catalogLevels
        : undefined;
    const capabilities = normalizeCapabilities(merged.capabilities, {
        reasoningEfforts: fallback || reasoningEfforts,
        hasEfforts: hasEfforts || Boolean(fallback?.length),
    });
    if (capabilities) merged.capabilities = capabilities;
    else delete merged.capabilities;
    return merged;
}

/**
 * Builds the provider-model entries for the app registry from a model.dev
 * selection. Existing entries keep their manual edits; catalog entries supply
 * limits and reasoning levels.
 */
export function prepareModels({
    providerName,
    selected,
    existingModels = [],
    catalogProvider = null,
}) {
    const entries = selectedModelEntries(selected);
    const existingById = new Map(
        existingModels
            .filter((model) => model && typeof model.id === "string")
            .map((model) => [model.id, model]),
    );
    const catalogById = new Map((catalogProvider?.models || []).map((model) => [model.id, model]));
    const result = [];

    for (const { id, wireModel, hasWireModel, reasoningEfforts, hasEfforts } of entries) {
        const existing = existingById.get(id);
        const catalogModel = catalogById.get(id);
        if (existing) {
            result.push(mergeExistingModel(
                existing,
                providerName,
                catalogModel,
                wireModel,
                hasWireModel,
                reasoningEfforts,
                hasEfforts,
            ));
        } else if (catalogModel) {
            result.push(buildProviderModel(catalogProvider, catalogModel, providerName, {
                wireModel,
                reasoningLevels: hasEfforts ? reasoningEfforts : undefined,
            }));
        } else {
            throw new ConfigError(
                `Model "${id}" is not in the current models.dev catalog. Refresh the catalog and try again.`,
            );
        }
    }

    return result;
}
