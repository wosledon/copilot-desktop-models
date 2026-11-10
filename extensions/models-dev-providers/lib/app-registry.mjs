import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeReasoningLevels } from "./config.mjs";
import { publicError } from "./util.mjs";

const PROVIDER_TYPES = new Set(["custom", "openai", "anthropic", "azure"]);
const AUTH_KINDS = new Set(["api_key", "bearer_token", "none"]);
const CREDENTIAL_KIND = { api_key: "apiKey", bearer_token: "bearerToken" };

let backupDone = false;

async function openDatabase(dbPath) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("pragma busy_timeout=5000");
    return db;
}

/** True when the Desktop app's own provider database exists. */
export async function hasAppRegistry(dbPath) {
    try {
        return (await stat(dbPath)).isFile();
    } catch {
        return false;
    }
}

function parseSettings(value) {
    try {
        const parsed = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function parseLevels(value) {
    if (typeof value !== "string" || !value) return [];
    try {
        return normalizeReasoningLevels(JSON.parse(value));
    } catch {
        return [];
    }
}

/**
 * Reads the app's "Other Providers" registry. Credentials never live here;
 * they stay in the OS credential store.
 */
export async function readAppRegistry(dbPath) {
    if (!(await hasAppRegistry(dbPath))) return { available: false, providers: [] };

    const db = await openDatabase(dbPath);
    try {
        const providers = db.prepare(
            "select id, name, type, settings_json, account_id from model_providers",
        ).all();
        const models = db.prepare(
            `select provider_id, model_id, wire_model, display_name, max_prompt_tokens,
                    max_output_tokens, wire_api_override, supported_reasoning_efforts, supports_vision
             from provider_models`,
        ).all();

        const modelsByProvider = new Map();
        for (const row of models) {
            if (!modelsByProvider.has(row.provider_id)) modelsByProvider.set(row.provider_id, []);
            modelsByProvider.get(row.provider_id).push({
                id: row.model_id,
                wireModel: row.wire_model || row.model_id,
                name: row.display_name || row.model_id,
                maxPromptTokens: row.max_prompt_tokens ?? null,
                maxOutputTokens: row.max_output_tokens ?? null,
                wireApiOverride: row.wire_api_override || null,
                efforts: parseLevels(row.supported_reasoning_efforts),
                vision: Number(row.supports_vision) === 1,
            });
        }

        return {
            available: true,
            providers: providers
                .filter((row) => row.type !== "github_copilot")
                .map((row) => {
                    const settings = parseSettings(row.settings_json);
                    return {
                        id: row.id,
                        name: row.name,
                        type: PROVIDER_TYPES.has(row.type) ? row.type : "custom",
                        baseUrl: typeof settings.baseUrl === "string" ? settings.baseUrl : "",
                        wireApi: typeof settings.wireApi === "string" ? settings.wireApi : "completions",
                        authKind: AUTH_KINDS.has(settings.authKind) ? settings.authKind : "api_key",
                        models: modelsByProvider.get(row.id) || [],
                    };
                }),
        };
    } finally {
        db.close();
    }
}

async function backupOnce(dbPath, backupDir, logger) {
    if (backupDone || !backupDir) return;
    backupDone = true;
    try {
        await mkdir(backupDir, { recursive: true });
        const existing = await readdir(backupDir).catch(() => []);
        if (existing.some((name) => name.startsWith("data.db."))) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await copyFile(dbPath, path.join(backupDir, `data.db.${stamp}`));
        const wal = `${dbPath}-wal`;
        await copyFile(wal, path.join(backupDir, `data.db.${stamp}-wal`)).catch(() => {});
    } catch (error) {
        logger?.warn?.(`Could not back up the Copilot app database: ${publicError(error)}`);
    }
}

/**
 * Creates, updates, or replaces one app provider and its model rows in a
 * single transaction. Returns the provider id that was written.
 */
export async function upsertAppProvider(dbPath, provider, models, { backupDir, logger } = {}) {
    await backupOnce(dbPath, backupDir, logger);
    const db = await openDatabase(dbPath);

    try {
        db.exec("begin immediate");
        try {
            const existingById = provider.appId
                ? db.prepare("select id from model_providers where id = ?").get(provider.appId)
                : undefined;
            const existingByName = existingById
                ? undefined
                : db.prepare("select id from model_providers where name = ? and type <> 'github_copilot'").get(provider.name);
            const id = existingById?.id || existingByName?.id || randomUUID();

            const settings = {
                baseUrl: provider.baseUrl,
                wireApi: provider.wireApi || "completions",
                authKind: provider.authKind || "api_key",
                headersJson: "{}",
            };

            if (existingById || existingByName) {
                db.prepare(
                    `update model_providers
                     set name = ?, type = ?, settings_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     where id = ?`,
                ).run(provider.name, provider.type || "custom", JSON.stringify(settings), id);
            } else {
                db.prepare(
                    `insert into model_providers (id, name, type, settings_json, account_id)
                     values (?, ?, ?, ?, null)`,
                ).run(id, provider.name, provider.type || "custom", JSON.stringify(settings));
            }

            const keep = new Set(models.map((model) => model.id));
            for (const row of db.prepare("select id, model_id from provider_models where provider_id = ?").all(id)) {
                if (!keep.has(row.model_id)) {
                    db.prepare("delete from provider_models where id = ?").run(row.id);
                }
            }

            for (const model of models) {
                const levels = normalizeReasoningLevels(model.reasoningEfforts || []);
                const values = [
                    model.name || model.id,
                    model.wireModel || model.id,
                    model.maxPromptTokens ?? null,
                    model.maxOutputTokens ?? null,
                    levels.length ? JSON.stringify(levels) : null,
                    model.vision ? 1 : 0,
                    model.wireApiOverride || null,
                    id,
                    model.id,
                ];
                const existing = db.prepare(
                    "select id from provider_models where provider_id = ? and model_id = ?",
                ).get(id, model.id);

                if (existing) {
                    db.prepare(
                        `update provider_models
                         set display_name = ?, wire_model = ?, max_prompt_tokens = ?, max_output_tokens = ?,
                             supported_reasoning_efforts = ?, supports_vision = ?, wire_api_override = ?,
                             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                         where provider_id = ? and model_id = ?`,
                    ).run(...values);
                } else {
                    db.prepare(
                        `insert into provider_models
                            (id, provider_id, model_id, display_name, wire_model, max_prompt_tokens,
                             max_output_tokens, supported_reasoning_efforts, supports_vision, wire_api_override)
                         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    ).run(
                        randomUUID(),
                        id,
                        model.id,
                        model.name || model.id,
                        model.wireModel || model.id,
                        model.maxPromptTokens ?? null,
                        model.maxOutputTokens ?? null,
                        levels.length ? JSON.stringify(levels) : null,
                        model.vision ? 1 : 0,
                        model.wireApiOverride || null,
                    );
                }
            }

            db.exec("commit");
            return { id };
        } catch (error) {
            try {
                db.exec("rollback");
            } catch {
                // The transaction may already be closed.
            }
            throw error;
        }
    } finally {
        db.close();
    }
}

export async function deleteAppProvider(dbPath, providerId) {
    if (!(await hasAppRegistry(dbPath))) return { deleted: false };
    const db = await openDatabase(dbPath);
    try {
        db.exec("begin immediate");
        try {
            db.prepare("delete from provider_models where provider_id = ?").run(providerId);
            const result = db.prepare("delete from model_providers where id = ?").run(providerId);
            db.exec("commit");
            return { deleted: Number(result.changes) > 0 };
        } catch (error) {
            try {
                db.exec("rollback");
            } catch {}
            throw error;
        }
    } finally {
        db.close();
    }
}

function credentialNames(providerId, kind) {
    const suffix = CREDENTIAL_KIND[kind];
    if (!suffix) throw new Error("Unsupported credential kind.");
    const service = `byok:${providerId}:${suffix}`;
    return {
        target: `${service}.github-copilot-app`,
        user: service,
    };
}

function runPowerShell(script, env) {
    return new Promise((resolve, reject) => {
        const encoded = Buffer.from(script, "utf16le").toString("base64");
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
            env: { ...process.env, ...env },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr.trim() || `powershell exited with ${code}`));
        });
    });
}

const CREDENTIAL_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win32 -Name Cred -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
}
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredWrite(ref CREDENTIAL credential, int flags);
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredDelete(string target, int type, int flags);
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr buffer);
'@
if ($env:MD_CRED_ACTION -eq 'read') {
    $ptr = [IntPtr]::Zero
    if (-not [Win32.Cred]::CredRead($env:MD_CRED_TARGET, 1, 0, [ref]$ptr)) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($code -eq 1168) { exit 0 }
        throw "CredRead failed: $code"
    }
    try {
        $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Win32.Cred+CREDENTIAL])
        $bytes = New-Object byte[] $cred.CredentialBlobSize
        [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
        $secret = [Text.Encoding]::Unicode.GetString($bytes)
        [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret))
    } finally {
        [Win32.Cred]::CredFree($ptr)
    }
    exit 0
}
if ($env:MD_CRED_ACTION -eq 'delete') {
    $ok = [Win32.Cred]::CredDelete($env:MD_CRED_TARGET, 1, 0)
    if (-not $ok) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($code -ne 1168) { throw "CredDelete failed: $code" }
    }
    exit 0
}
$secret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:MD_CRED_SECRET))
$bytes = [Text.Encoding]::Unicode.GetBytes($secret)
$cred = New-Object Win32.Cred+CREDENTIAL
$cred.Type = 1
$cred.TargetName = $env:MD_CRED_TARGET
$cred.UserName = $env:MD_CRED_USER
$cred.Persist = 2
$cred.CredentialBlobSize = $bytes.Length
$cred.CredentialBlob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[Runtime.InteropServices.Marshal]::Copy($bytes, 0, $cred.CredentialBlob, $bytes.Length)
try {
    if (-not [Win32.Cred]::CredWrite([ref]$cred, 0)) {
        throw "CredWrite failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
} finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($cred.CredentialBlob)
}
`;

/** Stores a provider credential in the same place the Desktop app uses. */
export async function writeAppCredential(providerId, kind, secret) {
    if (process.platform !== "win32") {
        return {
            ok: false,
            message: "Automatic credential storage is only implemented for Windows. Enter the key once in Copilot Desktop.",
        };
    }
    if (typeof secret !== "string" || !secret) {
        return { ok: false, message: "No credential was supplied." };
    }
    const names = credentialNames(providerId, kind);
    await runPowerShell(CREDENTIAL_SCRIPT, {
        MD_CRED_ACTION: "write",
        MD_CRED_TARGET: names.target,
        MD_CRED_USER: names.user,
        MD_CRED_SECRET: Buffer.from(secret, "utf8").toString("base64"),
    });
    return { ok: true, message: "Credential stored in the Windows credential store." };
}

export async function deleteAppCredential(providerId, kind) {
    if (process.platform !== "win32") return { ok: false };
    const names = credentialNames(providerId, kind);
    try {
        await runPowerShell(CREDENTIAL_SCRIPT, {
            MD_CRED_ACTION: "delete",
            MD_CRED_TARGET: names.target,
        });
        return { ok: true };
    } catch {
        return { ok: false };
    }
}

/** Reads back a stored credential so a live session can be registered. */
export async function readAppCredential(providerId, kind) {
    if (process.platform !== "win32") return null;
    const names = credentialNames(providerId, kind);
    try {
        const encoded = await runPowerShell(CREDENTIAL_SCRIPT, {
            MD_CRED_ACTION: "read",
            MD_CRED_TARGET: names.target,
        });
        if (!encoded) return null;
        return Buffer.from(encoded, "base64").toString("utf8");
    } catch {
        return null;
    }
}

export async function deleteAppProviderCredentials(providerId, logger) {
    for (const kind of ["api_key", "bearer_token"]) {
        try {
            await deleteAppCredential(providerId, kind);
        } catch (error) {
            logger?.warn?.(`Could not remove ${kind} for ${providerId}: ${publicError(error)}`);
        }
    }
}
