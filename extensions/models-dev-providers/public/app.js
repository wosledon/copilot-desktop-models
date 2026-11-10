const $ = (selector, root = document) => root.querySelector(selector);

const ICONS = {
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>`,
    checkCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.7 17a1.7 1.7 0 0 0 1.5 2.5h15.6a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
    external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>`,
    database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg>`,
    arrowLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
};

const REASONING_LEVELS = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

const TYPE_LABELS = {
    openai: "OpenAI-compatible",
    anthropic: "Anthropic",
    azure: "Azure OpenAI",
    configured: "Local configuration",
};

const COMPATIBILITY = {
    native: { label: "Native", className: "badge-native" },
    compatible: { label: "Compatible", className: "badge-compatible" },
    experimental: { label: "Experimental", className: "badge-experimental" },
    manual: { label: "Manual setup", className: "badge-manual" },
    builtin: { label: "Built in", className: "badge-builtin" },
    configured: { label: "Local config", className: "badge-config" },
};

const ui = {
    detail: $("#detail"),
    providerList: $("#provider-list"),
    providerSearch: $("#provider-search"),
    filterTabs: $(".filter-tabs"),
    providerTotal: $("#provider-total"),
    installedCount: $("#installed-count"),
    catalogFooter: $("#catalog-footer"),
    banner: $("#banner"),
    refreshButton: $("#refresh-button"),
    copyPath: $("#copy-path"),
    storagePath: $("#storage-path"),
    toastRegion: $("#toast-region"),
    selectionStatus: $("#selection-status"),
    dialog: $("#confirm-dialog"),
    confirmTitle: $("#confirm-title"),
    confirmMessage: $("#confirm-message"),
    confirmCancel: $("#confirm-cancel"),
    confirmOk: $("#confirm-ok"),
};

const state = {
    data: null,
    filter: "all",
    search: "",
    selectedKey: null,
    detail: null,
    busy: false,
    entryCache: null,
};

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[character]));
}

function icon(name) {
    return ICONS[name] || "";
}

function formatCount(value) {
    return new Intl.NumberFormat("en", { notation: value >= 100_000 ? "compact" : "standard" }).format(value || 0);
}

function formatTokens(value) {
    if (!Number.isFinite(value) || value <= 0) return null;
    if (value >= 1_000_000) {
        const millions = value / 1_000_000;
        return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
    }
    if (value >= 1000) {
        const thousands = value / 1000;
        return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
    }
    return String(value);
}

function formatRelativeTime(value) {
    if (!value) return "unknown";
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "unknown";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

function safeHttpUrl(value) {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
        return null;
    }
}

function isLocalUrl(value) {
    if (!value) return false;
    try {
        const host = new URL(value).hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
    } catch {
        return false;
    }
}

function toneFor(value) {
    let hash = 0;
    for (const character of String(value || "")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash % 8;
}

function initialsFor(value) {
    const words = String(value || "?").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
    return String(value || "?").slice(0, 2).toUpperCase();
}

function typeLabel(type) {
    return TYPE_LABELS[type] || "OpenAI-compatible";
}

function compatibilityInfo(compatibility) {
    return COMPATIBILITY[compatibility] || COMPATIBILITY.manual;
}

function setStatus(message) {
    ui.selectionStatus.textContent = message;
}

async function apiFetch(path, options = {}) {
    const request = {
        credentials: "same-origin",
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
        },
    };
    const response = await fetch(path, request);
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (!response.ok) {
        const error = new Error(payload?.error?.message || `Request failed with HTTP ${response.status}.`);
        error.code = payload?.error?.code || "request_failed";
        error.status = response.status;
        throw error;
    }
    return payload;
}

function toast(message, { type = "info", duration = 5200 } = {}) {
    const node = document.createElement("div");
    node.className = `toast is-${type}`;
    const iconName = type === "success" ? "checkCircle" : type === "error" || type === "warning" ? "alert" : "info";
    node.innerHTML = `
        <span class="toast-icon" aria-hidden="true">${icon(iconName)}</span>
        <span class="toast-message"></span>
        <button class="toast-close" type="button" aria-label="Dismiss notification">${icon("close")}</button>
    `;
    $(".toast-message", node).textContent = message;
    const dismiss = () => {
        node.remove();
    };
    $(".toast-close", node).addEventListener("click", dismiss);
    ui.toastRegion.appendChild(node);
    while (ui.toastRegion.children.length > 4) ui.toastRegion.firstElementChild.remove();
    const timer = setTimeout(dismiss, Math.max(2200, duration));
    node.addEventListener("mouseenter", () => clearTimeout(timer), { once: true });
}

function confirmAction({ title, message, confirmLabel = "Confirm", danger = false }) {
    if (ui.dialog.open) return Promise.resolve(false);
    return new Promise((resolve) => {
        ui.confirmTitle.textContent = title;
        ui.confirmMessage.textContent = message;
        ui.confirmOk.textContent = confirmLabel;
        ui.confirmOk.className = danger ? "button button-danger" : "button";
        if (ui.dialog.open) ui.dialog.close();

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (ui.dialog.open) ui.dialog.close();
            resolve(value);
        };
        const onCancel = (event) => {
            event.preventDefault();
            finish(false);
        };
        const onBackdrop = (event) => {
            if (event.target === ui.dialog) finish(false);
        };
        const onCancelClick = () => finish(false);
        const onOkClick = () => finish(true);
        const cleanup = () => {
            ui.dialog.removeEventListener("cancel", onCancel);
            ui.dialog.removeEventListener("click", onBackdrop);
            ui.confirmCancel.removeEventListener("click", onCancelClick);
            ui.confirmOk.removeEventListener("click", onOkClick);
        };

        ui.dialog.addEventListener("cancel", onCancel);
        ui.dialog.addEventListener("click", onBackdrop);
        ui.confirmCancel.addEventListener("click", onCancelClick);
        ui.confirmOk.addEventListener("click", onOkClick);
        ui.dialog.showModal();
        setTimeout(() => (danger ? ui.confirmCancel : ui.confirmOk).focus(), 0);
    });
}

function getEntries() {
    if (!state.data) return [];
    const configured = state.data.configured;
    const catalog = state.data.catalog;
    if (
        state.entryCache
        && state.entryCache.configured === configured
        && state.entryCache.catalog === catalog
    ) {
        return state.entryCache.entries;
    }

    const catalogProviders = catalog?.providers || [];
    const configuredProviders = configured?.providers || [];
    const configuredModels = configured?.models || [];
    const modelsByProvider = new Map();
    for (const model of configuredModels) {
        if (!model || typeof model.provider !== "string") continue;
        if (!modelsByProvider.has(model.provider)) modelsByProvider.set(model.provider, []);
        modelsByProvider.get(model.provider).push(model);
    }

    const matchedCatalogIds = new Set();
    const catalogForConfig = new Map();

    for (const config of configuredProviders) {
        const byName = catalogProviders.find(
            (provider) => provider.id === config.name && !matchedCatalogIds.has(provider.id),
        );
        if (byName) {
            catalogForConfig.set(config.name, byName);
            matchedCatalogIds.add(byName.id);
        }
    }

    for (const config of configuredProviders) {
        if (catalogForConfig.has(config.name) || !config.baseUrl) continue;
        const byUrl = catalogProviders.find(
            (provider) => !matchedCatalogIds.has(provider.id)
                && provider.baseUrl
                && provider.baseUrl.replace(/\/+$/, "") === config.baseUrl.replace(/\/+$/, ""),
        );
        if (byUrl) {
            catalogForConfig.set(config.name, byUrl);
            matchedCatalogIds.add(byUrl.id);
        }
    }

    const entries = [];
    const configuredNames = new Set();
    for (const config of configuredProviders) {
        configuredNames.add(config.name);
        const models = modelsByProvider.get(config.name) || [];
        const catalogProvider = catalogForConfig.get(config.name);
        if (catalogProvider) {
            entries.push({
                key: `catalog:${catalogProvider.id}`,
                provider: catalogProvider,
                installed: config,
                configModels: models,
                searchText: [
                    catalogProvider.id,
                    catalogProvider.name,
                    catalogProvider.npm,
                    catalogProvider.env?.join(" "),
                    config.name,
                    config.type,
                ].filter(Boolean).join(" ").toLowerCase(),
            });
        } else {
            entries.push({
                key: `config:${config.name}`,
                provider: {
                    id: null,
                    name: config.name,
                    compatibility: "configured",
                    type: config.type || "openai",
                    baseUrl: config.baseUrl || "",
                    wireApi: config.wireApi || "completions",
                    modelProvider: config.modelProvider,
                    env: [],
                    doc: null,
                    npm: null,
                    modelCount: models.length,
                    models: [],
                    configOnly: true,
                },
                installed: config,
                configModels: models,
                searchText: [
                    config.name,
                    config.type,
                    config.baseUrl,
                    ...models.map((model) => `${model.id} ${model.name || ""}`),
                ].filter(Boolean).join(" ").toLowerCase(),
            });
        }
    }

    for (const catalogProvider of catalogProviders) {
        if (matchedCatalogIds.has(catalogProvider.id)) continue;
        entries.push({
            key: `catalog:${catalogProvider.id}`,
            provider: catalogProvider,
            installed: null,
            configModels: [],
            searchText: [
                catalogProvider.id,
                catalogProvider.name,
                catalogProvider.npm,
                catalogProvider.env?.join(" "),
            ].filter(Boolean).join(" ").toLowerCase(),
        });
    }

    entries.sort((left, right) => {
        if (Boolean(right.installed) !== Boolean(left.installed)) return left.installed ? -1 : 1;
        return left.provider.name.localeCompare(right.provider.name, "en", { sensitivity: "base" });
    });

    state.entryCache = { configured, catalog, entries };
    return entries;
}

function entryMatchesSearch(entry, needle) {
    if (!needle) return true;
    return entrySearchScore(entry, needle) >= 0;
}

function entrySearchScore(entry, needle) {
    if (!needle) return 0;
    const providerText = `${entry.provider.id || ""} ${entry.provider.name || ""} ${entry.provider.npm || ""} ${entry.provider.env?.join(" ") || ""}`.toLowerCase();
    if (providerText.includes(needle)) return 0;
    if (entry.searchText.includes(needle)) return 0;
    for (const model of entry.provider.models || []) {
        if (`${model.id} ${model.name} ${model.family || ""}`.toLowerCase().includes(needle)) return 1;
    }
    for (const model of entry.configModels || []) {
        if (`${model.id} ${model.name || ""}`.toLowerCase().includes(needle)) return 1;
    }
    return -1;
}

function entryMatchesFilter(entry) {
    if (state.filter === "installed") return Boolean(entry.installed);
    if (state.filter === "ready") {
        if (entry.installed) return true;
        return ["native", "compatible", "experimental"].includes(entry.provider.compatibility);
    }
    return true;
}

function visibleEntries() {
    const needle = state.search.trim().toLowerCase();
    return getEntries()
        .filter((entry) => entryMatchesFilter(entry) && entryMatchesSearch(entry, needle))
        .sort((left, right) => {
            if (Boolean(right.installed) !== Boolean(left.installed)) return left.installed ? -1 : 1;
            if (needle) {
                const scoreDiff = entrySearchScore(left, needle) - entrySearchScore(right, needle);
                if (scoreDiff) return scoreDiff;
            }
            return left.provider.name.localeCompare(right.provider.name, "en", { sensitivity: "base" });
        });
}

function findEntry(key) {
    return getEntries().find((entry) => entry.key === key) || null;
}

function effortLevelsFor(model) {
    const levels = model?.capabilities?.supports?.reasoning_effort;
    return Array.isArray(levels) ? levels.filter((level) => REASONING_LEVELS.includes(level)) : [];
}

function buildManualModels(entry) {
    const catalogIds = new Set((entry.provider.models || []).map((model) => model.id));
    return (entry.configModels || [])
        .filter((model) => !catalogIds.has(model.id))
        .map((model) => {
            const efforts = effortLevelsFor(model);
            const reasoning = efforts.length > 0
                || model.capabilities?.supports?.thinking === true
                || model.capabilities?.supports?.reasoningEffort === true;
            return {
                id: model.id,
                name: model.name || model.id,
                family: model.capabilities?.family || null,
                description: null,
                toolCalls: model.capabilities?.supports?.toolCalls === true,
                reasoning,
                reasoningEffort: reasoning,
                efforts,
                vision: model.capabilities?.supports?.vision === true,
                pdf: false,
                context: model.maxContextWindowTokens || model.maxPromptTokens || null,
                input: model.maxPromptTokens || null,
                output: model.maxOutputTokens || null,
                releaseDate: null,
                lastUpdated: null,
                status: "saved",
                openWeights: false,
                canonicalId: model.modelId || null,
                manual: true,
            };
        });
}

function detailSnapshot(detail) {
    if (!detail || detail.builtin) return "";
    return JSON.stringify({
        name: detail.form.name,
        type: detail.form.type,
        baseUrl: detail.form.baseUrl,
        wireApi: detail.form.wireApi,
        azureApiVersion: detail.form.azureApiVersion,
        authMode: detail.form.authMode,
        secret: detail.form.secret,
        activate: detail.form.activate,
        selected: [...detail.selected].sort(),
        wireModels: [...detail.wireModels.entries()].sort(([left], [right]) => left.localeCompare(right)),
        efforts: [...detail.efforts.entries()]
            .map(([id, levels]) => [id, [...levels]])
            .sort(([left], [right]) => left.localeCompare(right)),
        manualIds: detail.manualModels.map((model) => model.id).sort(),
    });
}

function isDirty() {
    if (!state.detail || state.detail.builtin) return false;
    return detailSnapshot(state.detail) !== state.detail.baseline;
}

function providerNameSeed(provider) {
    const raw = String(provider.id || provider.name || "provider");
    const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
    return (cleaned || "provider").slice(0, 64);
}

function buildDetail(entry) {
    if (entry.provider.compatibility === "builtin") {
        return { entry, builtin: true, baseline: "" };
    }

    const provider = entry.provider;
    const installed = entry.installed;
    const configModels = entry.configModels || [];
    const catalogModels = provider.models || [];
    const catalogIds = new Set(catalogModels.map((model) => model.id));
    const manualModels = buildManualModels(entry);

    const selected = new Set();
    const wireModels = new Map();
    const efforts = new Map();
    for (const model of configModels) {
        if (!model || typeof model.id !== "string") continue;
        selected.add(model.id);
        if (model.wireModel) wireModels.set(model.id, model.wireModel);
        const levels = effortLevelsFor(model);
        if (levels.length) efforts.set(model.id, levels);
    }

    const detail = {
        entry,
        provider,
        installed,
        catalogIds,
        manualModels,
        selected,
        wireModels,
        efforts,
        form: {
            name: installed?.name || providerNameSeed(provider),
            type: installed?.type || provider.type || "openai",
            baseUrl: installed?.baseUrl || provider.baseUrl || "",
            wireApi: installed?.wireApi || provider.wireApi || "completions",
            azureApiVersion: installed?.azure?.apiVersion || "",
            authMode: installed
                ? (installed.hasBearerToken ? "bearer" : installed.hasApiKey ? "apiKey" : "none")
                : (isLocalUrl(provider.baseUrl) ? "none" : "apiKey"),
            secret: "",
            activate: Boolean(state.data?.session?.liveProviderApi),
        },
        modelQuery: "",
        modelSort: "recommended",
        hideDeprecated: false,
        advancedOpen: false,
    };
    detail.baseline = detailSnapshot(detail);
    return detail;
}

function selectEntry(key, { scroll = false } = {}) {
    const entry = findEntry(key);
    if (!entry) {
        state.selectedKey = null;
        state.detail = null;
        renderProviderList();
        renderDetail();
        return;
    }
    state.selectedKey = key;
    state.detail = buildDetail(entry);
    renderProviderList();
    renderDetail();
    if (scroll) {
        requestAnimationFrame(() => {
            const row = ui.providerList.querySelector(`[data-provider-key="${CSS.escape(key)}"]`);
            row?.scrollIntoView({ block: "nearest" });
        });
    }
}

async function attemptSelectEntry(key) {
    if (state.busy) return;
    if (key === state.selectedKey) return;
    if (isDirty()) {
        const confirmed = await confirmAction({
            title: "Discard unsaved changes?",
            message: "Your edits to this provider have not been saved. Switching providers will discard them.",
            confirmLabel: "Discard changes",
            danger: true,
        });
        if (!confirmed) return;
    }
    selectEntry(key);
}

function storagePath() {
    return state.data?.appDatabasePath || "data.db";
}

function storageLabel() {
    return "Copilot Desktop · Other Providers";
}

function renderHeader() {
    const entries = visibleEntries();
    ui.providerTotal.textContent = state.data ? formatCount(entries.length) : "—";
    ui.installedCount.textContent = String(state.data?.configured?.counts?.providers || 0);
    if (state.data?.appDatabasePath) {
        ui.storagePath.textContent = storagePath();
        ui.copyPath.title = `Copy ${storagePath()}`;
    }
}

function renderCatalogFooter() {
    if (!state.data) {
        ui.catalogFooter.textContent = "Loading the models.dev catalog…";
        return;
    }
    const counts = state.data.catalog?.counts || { providers: 0, models: 0 };
    const catalog = state.data.catalog || {};
    const dotClass = catalog.error ? "is-warn" : "";
    const updated = catalog.checkedAt || catalog.fetchedAt;
    const cacheLabel = catalog.error
        ? "cached"
        : catalog.fromCache
            ? "cached"
            : "live";
    ui.catalogFooter.innerHTML = `
        <div class="catalog-status-line"><span class="status-dot ${dotClass}"></span><strong>${formatCount(counts.providers)} providers · ${formatCount(counts.models)} models</strong></div>
        <div class="catalog-status-line" title="${escapeHtml(catalog.error || "")}">
            <span>Updated ${escapeHtml(formatRelativeTime(updated))} · ${escapeHtml(cacheLabel)}</span>
        </div>
    `;
}

function renderBanner() {
    if (!state.data) {
        ui.banner.hidden = true;
        return;
    }

    const registryError = state.data.registryError;
    const catalog = state.data.catalog || {};

    if (registryError) {
        ui.banner.hidden = false;
        ui.banner.className = "banner is-error";
        ui.banner.innerHTML = `
            <span class="banner-icon" aria-hidden="true">${icon("alert")}</span>
            <div class="banner-copy">
                <p class="banner-title">Copilot Desktop's provider registry is unavailable</p>
                <p class="banner-message"></p>
            </div>
        `;
        $(".banner-message", ui.banner).textContent = registryError;
        return;
    }

    if (catalog.error) {
        ui.banner.hidden = false;
        ui.banner.className = `banner ${catalog.providers.length ? "is-warning" : "is-error"}`;
        ui.banner.innerHTML = `
            <span class="banner-icon" aria-hidden="true">${icon(catalog.providers.length ? "alert" : "info")}</span>
            <div class="banner-copy">
                <p class="banner-title">${catalog.providers.length ? "Using cached models.dev data" : "models.dev is unavailable"}</p>
                <p class="banner-message"></p>
            </div>
            <div class="banner-actions">
                <button class="button button-subtle" type="button" data-action="retry-catalog">Retry</button>
            </div>
        `;
        $(".banner-message", ui.banner).textContent = catalog.error;
        return;
    }

    ui.banner.hidden = true;
    ui.banner.innerHTML = "";
}

function providerRow(entry) {
    const provider = entry.provider;
    const installed = Boolean(entry.installed);
    const active = state.selectedKey === entry.key;
    const tone = toneFor(provider.name);
    let subline;
    if (provider.compatibility === "builtin") subline = "Built into Copilot";
    else if (provider.configOnly) subline = `${entry.configModels.length} saved model${entry.configModels.length === 1 ? "" : "s"} · Local config`;
    else subline = `${formatCount(provider.modelCount)} models · ${typeLabel(provider.type)}`;

    return `
        <button type="button" class="provider-row ${active ? "is-active" : ""}" data-provider-key="${escapeHtml(entry.key)}" aria-pressed="${active}" title="${escapeHtml(provider.name)}">
            <span class="provider-avatar tone-${tone}" aria-hidden="true">${escapeHtml(initialsFor(provider.name))}</span>
            <span class="provider-copy">
                <span class="provider-name-line">
                    <span class="provider-name">${escapeHtml(provider.name)}</span>
                    ${installed ? `<span class="installed-dot" title="Installed" aria-label="Installed"></span>` : ""}
                </span>
                <span class="provider-subline">${escapeHtml(subline)}</span>
            </span>
            <span class="provider-row-chevron" aria-hidden="true">${icon("chevron")}</span>
        </button>
    `;
}

function renderProviderList() {
    if (!state.data) return;
    const visible = visibleEntries();
    const installed = visible.filter((entry) => entry.installed);
    const catalog = visible.filter((entry) => !entry.installed);

    if (!visible.length) {
        const hasFilters = state.search || state.filter !== "all";
        ui.providerList.innerHTML = `
            <div class="empty-panel">
                ${icon(hasFilters ? "search" : "database")}
                <span>${hasFilters ? "No providers match the current filters." : "The models.dev catalog is empty."}</span>
                ${hasFilters ? `<button class="button button-subtle" type="button" data-action="clear-filters">Clear filters</button>` : ""}
            </div>
        `;
        return;
    }

    const groups = [];
    if (installed.length) {
        groups.push(`<div class="provider-group"><div class="provider-group-label">Installed</div>${installed.map(providerRow).join("")}</div>`);
    }
    if (catalog.length) {
        groups.push(`<div class="provider-group"><div class="provider-group-label">models.dev catalog</div>${catalog.map(providerRow).join("")}</div>`);
    }
    ui.providerList.innerHTML = groups.join("");
}

function authSecretLabel(detail) {
    return detail.form.authMode === "bearer" ? "Bearer token" : "API key";
}

function authSecretHint(detail) {
    if (detail.form.authMode === "none") return "No credential will be stored.";
    if (detail.installed && detail.form.authMode === "apiKey" && detail.installed.hasApiKey) {
        return "A key is already stored. Leave this blank to keep it.";
    }
    if (detail.installed && detail.form.authMode === "bearer" && detail.installed.hasBearerToken) {
        return "A bearer token is already stored. Leave this blank to keep it.";
    }
    return "Stored in the OS credential store and never sent to the model.";
}

function envHint(provider) {
    const variables = (provider.env || []).slice(0, 2);
    if (!variables.length) return "";
    return `<span class="env-hint">Catalog env: ${variables.map((name) => `<code>${escapeHtml(name)}</code>`).join(" ")}</span>`;
}

function renderWelcome() {
    const counts = state.data?.catalog?.counts || { providers: 0, models: 0 };
    const installedCount = state.data?.configured?.counts?.providers || 0;
    const installedEntries = getEntries().filter((entry) => entry.installed);
    const installedCards = installedEntries.length
        ? installedEntries.map((entry) => {
            const provider = entry.provider;
            const configModels = entry.configModels?.length || 0;
            const meta = provider.configOnly
                ? `${configModels} saved model${configModels === 1 ? "" : "s"} · Not in catalog`
                : `${configModels} saved model${configModels === 1 ? "" : "s"} · ${provider.configOnly ? "Local config" : entry.installed?.source === "app" ? "Copilot app" : typeLabel(provider.type)}`;
            return `
                <button class="installed-card" type="button" data-open-entry="${escapeHtml(entry.key)}">
                    <span class="provider-avatar tone-${toneFor(provider.name)}" aria-hidden="true">${escapeHtml(initialsFor(provider.name))}</span>
                    <span class="installed-card-copy">
                        <span class="installed-card-name">${escapeHtml(provider.name)}</span>
                        <span class="installed-card-meta">${escapeHtml(meta)}</span>
                    </span>
                    <span class="provider-row-chevron" aria-hidden="true">${icon("chevron")}</span>
                </button>
            `;
        }).join("")
        : `<div class="empty-panel">${icon("database")}<span>No providers are installed yet. Pick one from the catalog to get started.</span></div>`;

    ui.detail.innerHTML = `
        <div class="detail-inner welcome">
            <section class="hero-card">
                <div class="hero-content">
                    <span class="eyebrow">models.dev connector</span>
                    <h2>Bring <span class="accent-text">any model</span> to Copilot.</h2>
                    <p class="hero-description">
                        Browse the open models.dev catalog, choose a provider, and add it to
                        Copilot Desktop's <code>Other Providers</code>. Mix OpenAI-compatible
                        endpoints alongside your Copilot models.
                    </p>
                    <div class="hero-stats">
                        <div class="hero-stat">
                            <span class="hero-stat-value">${formatCount(counts.providers)}</span>
                            <span class="hero-stat-label">Providers</span>
                        </div>
                        <div class="hero-stat">
                            <span class="hero-stat-value">${formatCount(counts.models)}</span>
                            <span class="hero-stat-label">Chat models</span>
                        </div>
                        <div class="hero-stat">
                            <span class="hero-stat-value">${formatCount(installedCount)}</span>
                            <span class="hero-stat-label">Installed</span>
                        </div>
                    </div>
                    <div class="hero-actions">
                        <button class="button" type="button" data-action="browse">
                            ${icon("spark")}<span>Browse providers</span>
                        </button>
                        <button class="button button-subtle" type="button" data-action="copy-path">
                            ${icon("copy")}<span>Copy config path</span>
                        </button>
                    </div>
                </div>
            </section>

            <section>
                <div class="section-heading">
                    <div>
                        <h3>Installed providers</h3>
                        <p>Saved in <span class="mono">${escapeHtml(storageLabel())}</span></p>
                    </div>
                </div>
                <div class="installed-grid">${installedCards}</div>
            </section>

            <section>
                <div class="section-heading">
                    <div>
                        <h3>How it works</h3>
                        <p>No extension-specific provider format to learn.</p>
                    </div>
                </div>
                <div class="steps">
                    <div class="step-card">
                        <span class="step-index">01</span>
                        <h4>Pick a provider</h4>
                        <p>Filter by ready to use, installed, or search across every model ID in the catalog.</p>
                    </div>
                    <div class="step-card">
                        <span class="step-index">02</span>
                        <h4>Choose models</h4>
                        <p>Select the exact chat models you want. Context, output, vision, and tool support are copied from models.dev.</p>
                    </div>
                    <div class="step-card">
                        <span class="step-index">03</span>
                        <h4>Save and select</h4>
                        <p>Credentials stay local. Register the provider in this session, then choose models from the Copilot picker.</p>
                    </div>
                </div>
            </section>
        </div>
    `;
}

function renderBuiltin() {
    const provider = state.detail.provider;
    ui.detail.innerHTML = `
        <div class="detail-inner">
            <div class="builtin-panel">
                <span class="badge badge-builtin">${icon("check")} Built into Copilot</span>
                <h2>${escapeHtml(provider.name)}</h2>
                <p>Copilot already serves these models through its own routing. There is no provider connection to configure here.</p>
                <div class="meta-strip">
                    <div class="meta-item"><span class="meta-label">Models</span><span class="meta-value">${formatCount(provider.modelCount)} chat models</span></div>
                    <div class="meta-item"><span class="meta-label">Endpoint</span><span class="meta-value is-mono">api.githubcopilot.com</span></div>
                </div>
                <button class="button button-subtle" type="button" data-action="browse">${icon("arrowLeft")}<span>Back to catalog</span></button>
            </div>
        </div>
    `;
}

function renderProviderDetail() {
    const detail = state.detail;
    const provider = detail.provider;
    const installed = detail.installed;
    const compatibility = compatibilityInfo(provider.compatibility);
    const tone = toneFor(provider.name);
    const configModelCount = detail.entry.configModels?.length || 0;
    const catalogModelCount = provider.modelCount || 0;
    const docs = safeHttpUrl(provider.doc);
    const noteClass = provider.compatibility === "experimental" || provider.compatibility === "manual"
        ? "note is-warning"
        : "note";
    const noteText = provider.configOnly
        ? "This provider is saved locally but does not match a models.dev catalog entry. You can edit its connection and existing models, but new catalog models cannot be added here."
        : provider.note;

    ui.detail.innerHTML = `
        <div class="detail-inner provider-detail">
            <header class="detail-head">
                <div class="provider-identity">
                    <span class="provider-avatar provider-avatar-lg tone-${tone}" aria-hidden="true">${escapeHtml(initialsFor(provider.name))}</span>
                    <div class="provider-identity-copy">
                        <div class="provider-title-row">
                            <h2>${escapeHtml(provider.name)}</h2>
                            <span class="badge ${compatibility.className}">${escapeHtml(compatibility.label)}</span>
                            <span class="badge" id="type-badge">${escapeHtml(typeLabel(detail.form.type))}</span>
                            ${installed ? `<span class="badge badge-installed">${icon("check")} Installed</span>` : ""}
                            ${installed?.source === "app" ? `<span class="badge badge-purple">Copilot app</span>` : ""}
                        </div>
                        <div class="provider-id-line">
                            <span>${escapeHtml(provider.id || provider.name)}</span>
                            ${provider.npm ? `<span>·</span><span>${escapeHtml(provider.npm)}</span>` : ""}
                        </div>
                    </div>
                </div>
                <div class="detail-links">
                    ${docs ? `<a class="button button-subtle" href="${escapeHtml(docs)}" target="_blank" rel="noreferrer">Docs ${icon("external")}</a>` : ""}
                </div>
            </header>

            <div class="meta-strip">
                <div class="meta-item">
                    <span class="meta-label">Protocol</span>
                    <span class="meta-value" id="protocol-value">${escapeHtml(typeLabel(detail.form.type))}${detail.form.type !== "anthropic" ? ` · ${escapeHtml(detail.form.wireApi)}` : ""}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">${provider.configOnly ? "Saved models" : "Catalog models"}</span>
                    <span class="meta-value">${formatCount(provider.configOnly ? configModelCount : catalogModelCount)}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Configured models</span>
                    <span class="meta-value">${formatCount(configModelCount)}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Source</span>
                    <span class="meta-value">${provider.configOnly ? "Local config" : "models.dev"}</span>
                </div>
            </div>

            ${noteText ? `<div class="${noteClass}">${icon(provider.configOnly ? "info" : "alert")}<span>${escapeHtml(noteText)}</span></div>` : ""}

            <form id="provider-form" novalidate>
                <section class="card">
                    <div class="card-head">
                        <div>
                            <h3 class="card-title">Connection</h3>
                            <p class="card-subtitle">Credentials go to the OS credential store; the provider and its models go to Copilot Desktop's Other Providers registry.</p>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="form-grid">
                            <label class="field">
                                <span class="field-label">Connection name</span>
                                <input id="form-name" data-field="name" type="text" value="${escapeHtml(detail.form.name)}" maxlength="64" spellcheck="false" autocomplete="off" ${installed && installed.source !== "app" ? "readonly" : ""}>
                                <span class="field-hint">Used as the provider ID in <span class="mono">provider/model</span> selection.</span>
                            </label>
                            <label class="field">
                                <span class="field-label">Provider type</span>
                                <select id="form-type" data-field="type">
                                    <option value="openai" ${detail.form.type === "openai" ? "selected" : ""}>OpenAI-compatible</option>
                                    <option value="anthropic" ${detail.form.type === "anthropic" ? "selected" : ""}>Anthropic</option>
                                    <option value="azure" ${detail.form.type === "azure" ? "selected" : ""}>Azure OpenAI</option>
                                </select>
                                <span class="field-hint">Copilot selects the API protocol from this value.</span>
                            </label>

                            <label class="field field-wide">
                                <span class="field-label">Base URL</span>
                                <input id="form-base-url" data-field="baseUrl" type="url" value="${escapeHtml(detail.form.baseUrl)}" spellcheck="false" autocomplete="off" placeholder="https://api.example.com/v1">
                                <span class="field-hint">${escapeHtml(
                                    detail.form.type === "anthropic"
                                        ? "Use the Anthropic-compatible root URL. Copilot appends /v1/messages."
                                        : detail.form.type === "azure"
                                            ? "Use your Azure resource or project endpoint. The /openai/v1 path is handled by Copilot."
                                            : "For OpenAI-compatible APIs, include the required prefix such as /v1.",
                                )} ${envHint(provider)}</span>
                            </label>

                            <label class="field">
                                <span class="field-label">Authentication</span>
                                <select id="form-auth-mode" data-field="authMode">
                                    <option value="apiKey" ${detail.form.authMode === "apiKey" ? "selected" : ""}>API key</option>
                                    <option value="bearer" ${detail.form.authMode === "bearer" ? "selected" : ""}>Bearer token</option>
                                    <option value="none" ${detail.form.authMode === "none" ? "selected" : ""}>No authentication</option>
                                </select>
                                <span class="field-hint">API keys use the provider header; bearer tokens use Authorization.</span>
                            </label>
                            <div class="field" id="auth-secret-field">
                                <label class="field-label" for="form-secret">${escapeHtml(authSecretLabel(detail))}</label>
                                <span class="secret-wrap">
                                    <input id="form-secret" data-field="secret" type="password" value="" spellcheck="false" autocomplete="new-password" placeholder="">
                                    <button id="toggle-secret" class="secret-toggle" type="button" aria-pressed="false">Show</button>
                                </span>
                                <span class="field-hint" id="auth-secret-hint">${escapeHtml(authSecretHint(detail))}</span>
                            </div>

                            <label class="field" id="wire-api-field">
                                <span class="field-label">Wire API</span>
                                <select id="form-wire-api" data-field="wireApi">
                                    <option value="completions" ${detail.form.wireApi === "completions" ? "selected" : ""}>Chat Completions</option>
                                    <option value="responses" ${detail.form.wireApi === "responses" ? "selected" : ""}>Responses</option>
                                </select>
                                <span class="field-hint">Use Responses for OpenAI GPT-5-series models and compatible endpoints.</span>
                            </label>
                            <label class="field" id="azure-api-field">
                                <span class="field-label">Azure API version <span class="optional">(optional)</span></span>
                                <input id="form-azure-version" data-field="azureApiVersion" type="text" value="${escapeHtml(detail.form.azureApiVersion)}" spellcheck="false" autocomplete="off" placeholder="Leave blank for the versionless route">
                                <span class="field-hint">Set only when your deployment requires a versioned route.</span>
                            </label>

                            ${state.data.session?.liveProviderApi ? `
                                <label class="check-field field-wide">
                                    <input id="form-activate" data-field="activate" type="checkbox" ${detail.form.activate ? "checked" : ""}>
                                    <span class="check-copy">
                                        <strong>Register in this session</strong>
                                        <span>${installed ? "Refresh this provider in the current session; the current model selection may reset." : "Try to make the provider available in the current Copilot session immediately."}</span>
                                    </span>
                                </label>
                            ` : ""}
                        </div>
                    </div>
                </section>

                <section class="card model-card stack-lg">
                    <div class="card-head">
                        <div>
                            <h3 class="card-title">Models <span class="count-pill" id="model-selected-count">0</span></h3>
                            <p class="card-subtitle">${provider.configOnly ? "Existing saved models. New catalog models cannot be added to a local-only provider." : "Select the chat models to expose in Copilot."}</p>
                        </div>
                        <div class="model-head-actions">
                            ${provider.models?.length ? `<button class="button button-subtle button-ghost" type="button" id="select-recommended">Select recommended</button>` : ""}
                            <button class="button button-subtle button-ghost" type="button" id="clear-models">Clear</button>
                        </div>
                    </div>
                    <div class="model-toolbar">
                        <label class="search-field">
                            <span class="search-icon" aria-hidden="true">${icon("search")}</span>
                            <input id="model-search" type="search" placeholder="Filter models" aria-label="Filter models" autocomplete="off" spellcheck="false">
                        </label>
                        <select id="model-sort" class="model-sort" aria-label="Sort models">
                            <option value="recommended">Recommended</option>
                            <option value="newest">Newest</option>
                            <option value="name">Name</option>
                            <option value="context">Context</option>
                        </select>
                        <label class="toggle-inline">
                            <input id="hide-deprecated" type="checkbox"> Hide deprecated
                        </label>
                    </div>
                    <div class="model-list" id="model-list"></div>
                </section>

                <details class="advanced stack-lg" id="advanced-panel" ${detail.advancedOpen ? "open" : ""}>
                    <summary>Advanced model mapping</summary>
                    <div class="advanced-body" id="wire-map"></div>
                </details>

                <div id="form-error" class="form-error" role="alert" hidden>${icon("alert")}<span></span></div>

                <div class="actionbar">
                    <div class="actionbar-copy">
                        <strong id="selection-count">0 models selected</strong>
                        <span id="save-hint">${installed ? "Saving replaces this provider's model list." : "Ready to add this provider."}</span>
                    </div>
                    <div class="actionbar-buttons">
                        ${installed ? `<button id="remove-provider" class="button button-danger" type="button">${icon("trash")}<span>Remove</span></button>` : ""}
                        <button id="save-provider" class="button" type="submit">${icon("check")}<span id="save-label">${installed ? "Save changes" : "Add provider"}</span></button>
                    </div>
                </div>
            </form>
        </div>
    `;

    renderModelList();
    renderWireMap();
    syncConditionalFields();
    updateActionbar();
}

function renderDetail() {
    if (!state.data) return;
    if (!state.detail) {
        renderWelcome();
        return;
    }
    if (state.detail.builtin) {
        renderBuiltin();
        return;
    }
    renderProviderDetail();
}

function sortedModels(detail) {
    const models = [
        ...(detail.provider.models || []),
        ...detail.manualModels,
    ];
    const query = detail.modelQuery.trim().toLowerCase();
    let filtered = models.filter((model) => {
        if (detail.hideDeprecated && model.status === "deprecated") return false;
        if (!query) return true;
        return `${model.id} ${model.name} ${model.family || ""}`.toLowerCase().includes(query);
    });

    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    filtered = [...filtered];
    if (detail.modelSort === "name") {
        filtered.sort((left, right) => collator.compare(left.name, right.name));
    } else if (detail.modelSort === "context") {
        filtered.sort((left, right) => (right.context || 0) - (left.context || 0) || collator.compare(left.name, right.name));
    } else if (detail.modelSort === "newest") {
        filtered.sort((left, right) => (right.releaseDate || "").localeCompare(left.releaseDate || "") || collator.compare(left.name, right.name));
    } else {
        filtered.sort((left, right) => {
            const deprecatedDiff = Number(left.status === "deprecated") - Number(right.status === "deprecated");
            if (deprecatedDiff) return deprecatedDiff;
            const toolDiff = Number(right.toolCalls) - Number(left.toolCalls);
            if (toolDiff) return toolDiff;
            return (right.releaseDate || "").localeCompare(left.releaseDate || "") || collator.compare(left.name, right.name);
        });
    }
    return filtered;
}

function modelBadges(model, detail) {
    const badges = [];
    if (model.status === "deprecated") badges.push(`<span class="model-badge is-deprecated">deprecated</span>`);
    else if (model.status === "beta") badges.push(`<span class="model-badge is-deprecated">beta</span>`);
    else if (model.status === "alpha") badges.push(`<span class="model-badge is-deprecated">alpha</span>`);
    if (model.manual) badges.push(`<span class="model-badge">saved</span>`);
    if (model.toolCalls) badges.push(`<span class="model-badge is-tool">tools</span>`);
    if (model.vision) badges.push(`<span class="model-badge is-vision">vision</span>`);
    if (model.reasoning) badges.push(`<span class="model-badge is-reasoning">reasoning</span>`);
    const levels = effectiveEfforts(detail, model);
    if (levels.length) {
        badges.push(`<span class="model-badge is-reasoning" title="${escapeHtml(levels.join(", "))}">effort ${levels.length}</span>`);
    }
    return badges.join("");
}

function effectiveEfforts(detail, model) {
    const override = detail?.efforts?.get(model.id);
    if (override) return override;
    if (Array.isArray(model.efforts) && model.efforts.length) return model.efforts;
    return [];
}

function modelRow(model, detail) {
    const checked = detail.selected.has(model.id);
    const context = formatTokens(model.context);
    const output = formatTokens(model.output);
    const deprecated = model.status === "deprecated" ? "is-deprecated" : "";
    const description = ` title="${escapeHtml(model.description || model.name)}"`;
    return `
        <label class="model-row ${checked ? "is-selected" : ""} ${deprecated}"${description}>
            <input type="checkbox" data-model-id="${escapeHtml(model.id)}" ${checked ? "checked" : ""}>
            <span class="model-copy">
                <span class="model-title-line">
                    <span class="model-name">${escapeHtml(model.name)}</span>
                    ${modelBadges(model, detail)}
                </span>
                <span class="model-id">${escapeHtml(model.id)}</span>
            </span>
            <span class="model-metrics">
                ${context ? `<span class="model-metric" title="Context window">${context} ctx</span>` : ""}
                ${output ? `<span class="model-metric" title="Maximum output">${output} out</span>` : ""}
            </span>
        </label>
    `;
}

function renderModelList() {
    const detail = state.detail;
    const container = $("#model-list");
    if (!detail || !container) return;
    const models = sortedModels(detail);
    if (!models.length) {
        const hasModels = (detail.provider.models?.length || 0) + detail.manualModels.length > 0;
        container.innerHTML = `<div class="model-empty">${hasModels ? "No models match this filter." : "No saved models. Remove this provider or re-add it with models."}</div>`;
    } else {
        container.innerHTML = models.map((model) => modelRow(model, detail)).join("");
    }
    updateModelCounts();
}

function selectedModelsForDetail(detail) {
    const map = new Map();
    for (const model of [...(detail.provider.models || []), ...detail.manualModels]) {
        map.set(model.id, model);
    }
    return [...detail.selected]
        .map((id) => map.get(id) || {
            id,
            name: id,
            family: null,
            manual: true,
            status: null,
            toolCalls: false,
            vision: false,
            reasoning: false,
            context: null,
            output: null,
        })
        .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
}

function renderWireMap() {
    const detail = state.detail;
    const container = $("#wire-map");
    if (!detail || !container) return;
    const selected = selectedModelsForDetail(detail);
    if (!selected.length) {
        container.innerHTML = `<span class="field-hint">Select models to configure optional wire names, deployment names, or reasoning effort levels.</span>`;
        return;
    }
    if (selected.length > 40) {
        container.innerHTML = `<span class="field-hint">Per-model overrides are available when 40 or fewer models are selected. Reduce this provider's model selection.</span>`;
        return;
    }
    container.innerHTML = `
        <p class="field-hint wire-help">Optional. Leave the wire name blank to send the model ID unchanged. Azure deployments usually need the deployment name here.</p>
        <div class="wire-grid">
            ${selected.map((model) => {
                const levels = effectiveEfforts(detail, model);
                const supportsEffort = model.reasoning === true || levels.length > 0;
                return `
                <div class="wire-field">
                    <span class="wire-label" title="${escapeHtml(model.id)}">${escapeHtml(model.name)}</span>
                    <input type="text" data-wire-id="${escapeHtml(model.id)}" value="${escapeHtml(detail.wireModels.get(model.id) || "")}" placeholder="${escapeHtml(model.id)}" aria-label="${escapeHtml(model.name)} wire model" spellcheck="false" autocomplete="off">
                    ${supportsEffort ? `<input type="text" data-effort-id="${escapeHtml(model.id)}" value="${escapeHtml(levels.join(", "))}" placeholder="low, medium, high" aria-label="${escapeHtml(model.name)} reasoning effort levels" spellcheck="false" autocomplete="off">` : ""}
                </div>
            `;
            }).join("")}
        </div>
        <p class="field-hint wire-help">Reasoning effort levels use Copilot's levels: none, minimal, low, medium, high, xhigh, max. Leave blank to let Copilot use its defaults for that model.</p>
    `;
}

function updateModelCounts() {
    const detail = state.detail;
    if (!detail) return;
    const counter = $("#model-selected-count");
    if (counter) counter.textContent = String(detail.selected.size);
}

function updateActionbar() {
    const detail = state.detail;
    if (!detail || detail.builtin) return;
    const selectionCount = $("#selection-count");
    const saveHint = $("#save-hint");
    const saveButton = $("#save-provider");
    const saveLabel = $("#save-label");
    if (!selectionCount || !saveButton) return;

    const count = detail.selected.size;
    selectionCount.textContent = `${count} model${count === 1 ? "" : "s"} selected`;

    if (state.busy) {
        saveHint.textContent = "Saving provider configuration…";
        saveButton.disabled = true;
        saveButton.classList.add("is-spinning");
        if (saveLabel) saveLabel.textContent = "Saving…";
        return;
    }

    const dirty = isDirty();
    saveHint.textContent = dirty
        ? "Unsaved changes."
        : detail.installed
            ? "Saving replaces this provider's model list."
            : "Ready to add this provider.";
    const nameValid = isValidProviderName(detail.form.name);
    const urlValid = Boolean(safeHttpUrl(detail.form.baseUrl));
    saveButton.disabled = count === 0 || !nameValid || !urlValid;
    saveButton.classList.remove("is-spinning");
    if (saveLabel) saveLabel.textContent = detail.installed ? "Save changes" : "Add provider";
}

function syncConditionalFields() {
    const detail = state.detail;
    if (!detail || detail.builtin) return;
    const wireField = $("#wire-api-field");
    const azureField = $("#azure-api-field");
    const secretField = $("#auth-secret-field");
    const secretInput = $("#form-secret");
    const baseUrlInput = $("#form-base-url");
    const secretToggle = $("#toggle-secret");

    if (wireField) wireField.hidden = detail.form.type === "anthropic";
    if (azureField) azureField.hidden = detail.form.type !== "azure";
    if (secretField) secretField.hidden = detail.form.authMode === "none";
    if (secretInput) {
        secretInput.disabled = detail.form.authMode === "none";
        secretInput.type = "password";
        secretInput.placeholder = (() => {
            if (detail.installed && detail.form.authMode === "apiKey" && detail.installed.hasApiKey) return "Stored key — leave blank to keep";
            if (detail.installed && detail.form.authMode === "bearer" && detail.installed.hasBearerToken) return "Stored token — leave blank to keep";
            return detail.form.authMode === "bearer" ? "Paste bearer token" : "Paste API key";
        })();
    }
    if (secretToggle) {
        secretToggle.textContent = "Show";
        secretToggle.setAttribute("aria-pressed", "false");
    }
    if (baseUrlInput) {
        baseUrlInput.placeholder = detail.form.type === "anthropic"
            ? "https://api.anthropic.com"
            : detail.form.type === "azure"
                ? "https://your-resource.openai.azure.com"
                : "https://api.example.com/v1";
    }
    updateSecretLabel();
    updateProtocolUi();
    updateNameValidity();
    updateBaseUrlValidity();
}

function updateSecretLabel() {
    const detail = state.detail;
    if (!detail) return;
    const label = $("#auth-secret-field .field-label");
    const hint = $("#auth-secret-hint");
    if (label) label.textContent = authSecretLabel(detail);
    if (hint) hint.textContent = authSecretHint(detail);
}

function updateProtocolUi() {
    const detail = state.detail;
    if (!detail) return;
    const badge = $("#type-badge");
    const protocol = $("#protocol-value");
    if (badge) badge.textContent = typeLabel(detail.form.type);
    if (protocol) {
        protocol.textContent = `${typeLabel(detail.form.type)}${detail.form.type !== "anthropic" ? ` · ${detail.form.wireApi}` : ""}`;
    }
}

function isValidProviderName(value) {
    const name = String(value || "").trim();
    return Boolean(name) && name.length <= 80 && !name.includes("/");
}

function updateNameValidity() {
    const input = $("#form-name");
    if (!input) return;
    if (input.readOnly) {
        input.classList.remove("is-invalid");
        return;
    }
    const valid = isValidProviderName(input.value);
    input.classList.toggle("is-invalid", Boolean(input.value.trim()) && !valid);
}

function updateBaseUrlValidity() {
    const input = $("#form-base-url");
    if (!input) return;
    const value = input.value.trim();
    input.classList.toggle("is-invalid", Boolean(value) && !safeHttpUrl(value));
}

function showFormError(message) {
    const node = $("#form-error");
    if (!node) return;
    const copy = $("span", node);
    if (copy) copy.textContent = message;
    node.hidden = false;
}

function clearFormError() {
    const node = $("#form-error");
    if (node) {
        node.hidden = true;
        const copy = $("span", node);
        if (copy) copy.textContent = "";
    }
}

function serializeModelSelection(detail) {
    return [...detail.selected].map((id) => {
        const selection = {
            id,
            wireModel: detail.wireModels.get(id) || "",
        };
        if (detail.efforts.has(id)) selection.reasoningEfforts = [...detail.efforts.get(id)];
        return selection;
    });
}

function validateForm(detail) {
    const name = detail.form.name.trim();
    if (!isValidProviderName(name)) {
        return "Enter a provider name of 1-80 characters without a slash.";
    }
    if (!safeHttpUrl(detail.form.baseUrl.trim())) {
        return "Enter a valid HTTP(S) base URL.";
    }
    if (!detail.selected.size) {
        return "Select at least one model.";
    }
    if (!detail.installed && detail.form.authMode !== "none" && !detail.form.secret.trim()) {
        return `Paste ${detail.form.authMode === "bearer" ? "a bearer token" : "an API key"}, or choose No authentication.`;
    }
    return null;
}

async function saveProvider(event) {
    event?.preventDefault();
    if (state.busy || !state.detail || state.detail.builtin) return;
    const detail = state.detail;
    clearFormError();
    const validationError = validateForm(detail);
    if (validationError) {
        showFormError(validationError);
        return;
    }

    state.busy = true;
    updateActionbar();
    const payload = {
        originalName: detail.installed?.name,
        appProviderId: detail.installed?.appId || null,
        catalogProviderId: detail.provider.configOnly ? null : detail.provider.id,
        provider: {
            name: detail.form.name.trim(),
            type: detail.form.type,
            baseUrl: detail.form.baseUrl.trim(),
            wireApi: detail.form.type === "anthropic" ? undefined : detail.form.wireApi,
            azure: detail.form.type === "azure"
                ? { apiVersion: detail.form.azureApiVersion.trim() || undefined }
                : undefined,
            auth: {
                mode: detail.form.authMode,
                value: detail.form.authMode === "none" ? "" : detail.form.secret,
            },
        },
        models: serializeModelSelection(detail),
        activate: Boolean(detail.form.activate),
    };

    try {
        const response = await apiFetch("api/providers", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        state.data.configured = response.config;
        state.data.registryError = null;
        state.busy = false;

        const live = response.live;
        if (live?.ok) toast(live.message || "Provider saved.", { type: "success" });
        else if (live?.skipped) toast(live.message || "Provider saved.", { type: "success", duration: 7000 });
        else toast(live?.message || "Provider saved, but live registration failed.", { type: "warning", duration: 9000 });

        const savedKey = getEntries().find((entry) => entry.installed?.name === response.providerName)?.key;
        renderHeader();
        renderBanner();
        renderCatalogFooter();
        if (savedKey) {
            selectEntry(savedKey);
        } else {
            state.selectedKey = null;
            state.detail = null;
            renderProviderList();
            renderDetail();
        }
        setStatus(`Provider ${response.providerName} saved.`);
    } catch (error) {
        state.busy = false;
        updateActionbar();
        showFormError(error.message);
        toast(error.message, { type: "error", duration: 9000 });
    }
}

async function removeProvider() {
    if (state.busy || !state.detail?.installed) return;
    const detail = state.detail;
    const confirmed = await confirmAction({
        title: `Remove ${detail.installed.name}?`,
        message: `This removes the provider and its ${detail.entry.configModels.length} saved model${detail.entry.configModels.length === 1 ? "" : "s"} from Copilot Desktop's Other Providers. This cannot be undone.`,
        confirmLabel: "Remove provider",
        danger: true,
    });
    if (!confirmed) return;

    state.busy = true;
    updateActionbar();
    try {
        const response = await apiFetch(`api/providers/${encodeURIComponent(detail.installed.appId || detail.installed.name)}`, {
            method: "DELETE",
        });
        state.data.configured = response.config;
        state.busy = false;
        state.selectedKey = null;
        state.detail = null;
        renderHeader();
        renderBanner();
        renderCatalogFooter();
        renderProviderList();
        renderDetail();
        const live = response.live;
        toast(live?.message || "Provider removed.", {
            type: live?.ok === false && !live?.skipped ? "warning" : "success",
            duration: live?.ok === false ? 9000 : 5000,
        });
        setStatus(`Provider ${detail.installed.name} removed.`);
    } catch (error) {
        state.busy = false;
        updateActionbar();
        toast(error.message, { type: "error", duration: 9000 });
    }
}

async function refreshCatalog() {
    if (state.busy) return;
    if (isDirty()) {
        const confirmed = await confirmAction({
            title: "Refresh models.dev?",
            message: "Refreshing the catalog will discard your unsaved changes.",
            confirmLabel: "Refresh and discard",
            danger: true,
        });
        if (!confirmed) return;
    }

    state.busy = true;
    ui.refreshButton.disabled = true;
    ui.refreshButton.classList.add("is-spinning");
    updateActionbar();
    try {
        const response = await apiFetch("api/refresh", {
            method: "POST",
            body: "{}",
        });
        state.data.catalog = response.catalog;
        state.busy = false;
        renderHeader();
        renderBanner();
        renderCatalogFooter();
        renderProviderList();

        if (state.selectedKey && findEntry(state.selectedKey)) {
            state.detail = buildDetail(findEntry(state.selectedKey));
            renderDetail();
        } else {
            state.selectedKey = null;
            state.detail = null;
            renderDetail();
        }

        if (response.catalog.error) {
            toast(response.catalog.error, { type: "warning", duration: 9000 });
        } else {
            toast("models.dev catalog refreshed.", { type: "success" });
        }
    } catch (error) {
        state.busy = false;
        toast(error.message, { type: "error", duration: 9000 });
    } finally {
        ui.refreshButton.disabled = false;
        ui.refreshButton.classList.remove("is-spinning");
        updateActionbar();
    }
}

async function copyConfigPath() {
    const value = storagePath();
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        toast("data.db path copied.", { type: "success" });
    } catch {
        toast(value, { type: "info", duration: 9000 });
    }
}

function clearFilters() {
    state.search = "";
    state.filter = "all";
    ui.providerSearch.value = "";
    for (const tab of ui.filterTabs.querySelectorAll("[data-filter]")) {
        const active = tab.dataset.filter === "all";
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-pressed", String(active));
    }
    renderHeader();
    renderProviderList();
}

function focusSearch() {
    ui.providerSearch.focus();
    ui.providerSearch.select();
}

async function loadState() {
    try {
        const data = await apiFetch("api/state");
        state.data = data;
        state.entryCache = null;
        renderHeader();
        renderBanner();
        renderCatalogFooter();
        renderProviderList();
        renderDetail();

        const wanted = new URLSearchParams(window.location.search).get("provider");
        if (wanted) {
            const direct = findEntry(`catalog:${wanted}`) || findEntry(`config:${wanted}`);
            if (direct) selectEntry(direct.key, { scroll: true });
        }
    } catch (error) {
        ui.detail.innerHTML = `
            <div class="detail-inner">
                <div class="detail-empty">
                    <span class="badge badge-danger">Failed to load</span>
                    <h2>The canvas could not start.</h2>
                    <p>${escapeHtml(error.message)}</p>
                    <button class="button" type="button" data-action="retry-load">Try again</button>
                </div>
            </div>
        `;
        ui.providerList.innerHTML = `<div class="empty-panel">${icon("alert")}<span>Catalog unavailable.</span></div>`;
        ui.catalogFooter.textContent = "models.dev catalog unavailable.";
    }
}

function bindEvents() {
    ui.filterTabs.addEventListener("click", (event) => {
        const tab = event.target.closest("[data-filter]");
        if (!tab) return;
        state.filter = tab.dataset.filter;
        for (const candidate of ui.filterTabs.querySelectorAll("[data-filter]")) {
            const active = candidate === tab;
            candidate.classList.toggle("is-active", active);
            candidate.setAttribute("aria-pressed", String(active));
        }
        renderHeader();
        renderProviderList();
    });

    let searchTimer;
    ui.providerSearch.addEventListener("input", () => {
        state.search = ui.providerSearch.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            renderHeader();
            renderProviderList();
        }, 70);
    });

    ui.providerList.addEventListener("click", (event) => {
        const row = event.target.closest("[data-provider-key]");
        if (row) {
            attemptSelectEntry(row.dataset.providerKey);
            return;
        }
        if (event.target.closest("[data-action='clear-filters']")) clearFilters();
    });

    ui.refreshButton.addEventListener("click", refreshCatalog);
    ui.copyPath.addEventListener("click", copyConfigPath);

    ui.banner.addEventListener("click", (event) => {
        if (event.target.closest("[data-action='retry-catalog']")) refreshCatalog();
    });

    ui.detail.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "browse") {
            focusSearch();
            return;
        }
        if (action === "copy-path") {
            copyConfigPath();
            return;
        }
        if (action === "retry-load") {
            loadState();
            return;
        }
        const openEntry = event.target.closest("[data-open-entry]");
        if (openEntry) {
            attemptSelectEntry(openEntry.dataset.openEntry);
            return;
        }
        if (event.target.closest("#toggle-secret")) {
            const input = $("#form-secret");
            const button = $("#toggle-secret");
            if (!input || !button) return;
            const visible = input.type === "text";
            input.type = visible ? "password" : "text";
            button.textContent = visible ? "Show" : "Hide";
            button.setAttribute("aria-pressed", String(!visible));
            return;
        }
        if (event.target.closest("#clear-models")) {
            state.detail.selected.clear();
            state.detail.wireModels.clear();
            state.detail.efforts.clear();
            renderModelList();
            renderWireMap();
            updateActionbar();
            setStatus("All models cleared.");
            return;
        }
        if (event.target.closest("#select-recommended")) {
            const ranked = sortedModels({ ...state.detail, modelQuery: "", hideDeprecated: false });
            let candidates = ranked
                .filter((model) => !model.manual && model.status !== "deprecated" && model.toolCalls)
                .slice(0, 5);
            if (!candidates.length) {
                candidates = ranked
                    .filter((model) => !model.manual && model.status !== "deprecated")
                    .slice(0, 5);
            }
            for (const model of candidates) state.detail.selected.add(model.id);
            renderModelList();
            renderWireMap();
            updateActionbar();
            setStatus(`${candidates.length} recommended models selected.`);
            return;
        }
        if (event.target.closest("#remove-provider")) {
            removeProvider();
        }
    });

    ui.detail.addEventListener("change", (event) => {
        const target = event.target;
        if (target.matches("[data-model-id]")) {
            const id = target.dataset.modelId;
            if (target.checked) state.detail.selected.add(id);
            else {
                state.detail.selected.delete(id);
                state.detail.wireModels.delete(id);
                state.detail.efforts.delete(id);
            }
            target.closest(".model-row")?.classList.toggle("is-selected", target.checked);
            updateModelCounts();
            updateActionbar();
            if ($("#advanced-panel")?.open) renderWireMap();
            setStatus(`${state.detail.selected.size} models selected.`);
            return;
        }
        if (target.id === "model-sort") {
            state.detail.modelSort = target.value;
            renderModelList();
            return;
        }
        if (target.id === "hide-deprecated") {
            state.detail.hideDeprecated = target.checked;
            renderModelList();
            return;
        }
        if (target.matches("[data-field]")) {
            clearFormError();
            if (target.id === "form-type") {
                state.detail.form.type = target.value;
                syncConditionalFields();
            } else if (target.id === "form-auth-mode") {
                state.detail.form.authMode = target.value;
                syncConditionalFields();
            } else if (target.id === "form-wire-api") {
                state.detail.form.wireApi = target.value;
                updateProtocolUi();
            } else if (target.type === "checkbox") {
                state.detail.form[target.dataset.field] = target.checked;
            } else {
                state.detail.form[target.dataset.field] = target.value;
            }
            updateActionbar();
        }
    });

    ui.detail.addEventListener("input", (event) => {
        const target = event.target;
        if (target.id === "model-search") {
            state.detail.modelQuery = target.value;
            renderModelList();
            return;
        }
        if (target.matches("[data-wire-id]")) {
            const id = target.dataset.wireId;
            const value = target.value;
            if (value.trim()) state.detail.wireModels.set(id, value);
            else state.detail.wireModels.delete(id);
            updateActionbar();
            return;
        }
        if (target.matches("[data-effort-id]")) {
            const id = target.dataset.effortId;
            const levels = target.value
                .split(",")
                .map((entry) => entry.trim().toLowerCase())
                .filter(Boolean);
            const invalid = levels.find((level) => !REASONING_LEVELS.includes(level));
            target.classList.toggle("is-invalid", Boolean(invalid));
            if (invalid) {
                showFormError(`"${invalid}" is not a reasoning effort level. Use ${REASONING_LEVELS.join(", ")}.`);
                return;
            }
            clearFormError();
            if (levels.length) state.detail.efforts.set(id, [...new Set(levels)]);
            else state.detail.efforts.delete(id);
            updateActionbar();
            return;
        }
        if (target.matches("[data-field]")) {
            clearFormError();
            state.detail.form[target.dataset.field] = target.value;
            if (target.id === "form-name") updateNameValidity();
            if (target.id === "form-base-url") updateBaseUrlValidity();
            updateActionbar();
        }
    });

    ui.detail.addEventListener("submit", (event) => {
        if (event.target.id === "provider-form") saveProvider(event);
    });

    ui.detail.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.target.id === "model-search") {
            event.preventDefault();
        }
    });

    ui.detail.addEventListener("toggle", (event) => {
        if (event.target.id !== "advanced-panel") return;
        state.detail.advancedOpen = event.target.open;
        if (event.target.open) renderWireMap();
    }, true);

    window.addEventListener("beforeunload", (event) => {
        if (!isDirty()) return;
        event.preventDefault();
        event.returnValue = "";
    });
}

bindEvents();
loadState();
