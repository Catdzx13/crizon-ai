/**
 * `crizon-ai ui` — trình quản lý trên máy (trang web cục bộ, thiết kế kiểu Apple):
 * bật/tắt Crizon cho từng app, gắn/thay key, chọn model, kiểm tra kết nối,
 * đăng nhập bằng trình duyệt, quản lý MCP + skill theo từng app, kho MCP/Skill (bảng xếp hạng).
 *
 * Bảo mật (chặt hơn `opencode web`): chỉ bind 127.0.0.1; mọi /api cần token ngẫu
 * nhiên (trang nhận qua #fragment, gửi bằng header Authorization); kiểm tra Host
 * (chống DNS rebinding) và Origin; CSP chặt, không script nội tuyến; API key không
 * bao giờ được trả về trang (chỉ dạng che).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { authorizeUrl, completeLogin, createLoginSession, listenLoopback, readCallback, resultPage, sendResultPage } from "./browser-login.mjs";
import { ApiError, CrizonClient } from "./client.mjs";
import { CatalogError, fetchCatalog, fetchCatalogItem, installCatalogItem } from "./catalog.mjs";
import { CodexConfigConflict } from "./codex-config.mjs";
import { applyHarness, disconnectHarness, reapplyConnectedHarnesses } from "./commands.mjs";
import { loadConfigFile, resolveConfig, saveConfigFile, updateConfigFile } from "./config.mjs";
import { HARNESSES, commandExists, detectProfilePath, harnessStatus, probeCompat } from "./harness.mjs";
import { getLang } from "./i18n.mjs";
import { addMcp, listMcp, McpError, removeMcp, setMcpApp } from "./mcp-manager.mjs";
import { openUrl } from "./open-url.mjs";
import { installGithubSkill, listSkills, previewGithubSkill, removeSkill, setSkillApp, SkillError } from "./skills-manager.mjs";
import { maskKey, VERSION } from "./util.mjs";

export const UI_PORT = 4730;
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "ui");
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/brands.js": ["brands.js", "text/javascript; charset=utf-8"],
  "/aider.png": ["aider.png", "image/png"],
  "/crizon.png": ["crizon.png", "image/png"],
  "/favicon.png": ["favicon.png", "image/png"],
};
// Ảnh kho (logo tác giả, ảnh bìa, ảnh trong README) chỉ từ host của GitHub — backend đã lọc sẵn.
const IMAGE_HOSTS = ["avatars.githubusercontent.com", "raw.githubusercontent.com", "user-images.githubusercontent.com", "private-user-images.githubusercontent.com", "repository-images.githubusercontent.com", "opengraph.githubassets.com", "github.com"];
const CSP = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: ${IMAGE_HOSTS.map((host) => `https://${host}`).join(" ")}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const APP_ORDER = ["claude", "codex", "tui", "aider", "qwen"];
const MAX_BODY = 64 * 1024;
const INSTALLED_TTL_MS = 15_000;

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body_too_large"), { status: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("invalid_json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sameToken(header, token) {
  const given = Buffer.from(String(header || "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Máy chủ trang quản lý. Trả { url, port, closed, close }. */
export async function startUiServer({ env = process.env, port = UI_PORT, fetchImpl } = {}) {
  const token = randomBytes(24).toString("base64url");
  const installedCache = new Map();
  // Mỗi file cấu hình chỉ backup 1 lần cho mỗi lần chạy trình quản lý (bật/tắt nhiều lần không sinh hàng loạt bản sao).
  const backups = new Set();
  let actualPort = 0;
  let login = null;
  let lastLogin = null;
  let finish;
  const closed = new Promise((resolve) => { finish = resolve; });

  const origins = () => [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`];
  const profilePathFor = (id) => loadConfigFile(env).harnessConfigs?.[id]?.profilePath || detectProfilePath(process.platform, env);

  function isInstalled(id) {
    if (id === "tui") return true;
    const cached = installedCache.get(id);
    if (cached && Date.now() - cached.at < INSTALLED_TTL_MS) return cached.value;
    const value = commandExists(HARNESSES[id].command);
    installedCache.set(id, { value, at: Date.now() });
    return value;
  }

  function state() {
    const cfg = resolveConfig({ env });
    return {
      version: VERSION,
      lang: getLang(),
      account: {
        hasKey: Boolean(cfg.apiKey),
        keyMasked: cfg.apiKey ? maskKey(cfg.apiKey) : "",
        source: cfg.source,
        baseUrl: cfg.baseUrl,
        portalUrl: cfg.portalUrl,
        model: cfg.model,
      },
      apps: APP_ORDER.filter((id) => HARNESSES[id]).map((id) => {
        const harness = HARNESSES[id];
        const profilePath = profilePathFor(id);
        return {
          id,
          name: harness.name,
          command: id === "tui" ? "crizon-ai tui" : harness.command,
          installHint: harness.hint,
          installed: isInstalled(id),
          connected: harnessStatus(env, id, { profilePath }).connected,
          target: harness.configFile ? harness.configFile(env) : profilePath,
          newTerminal: !harness.configFile && id !== "tui",
        };
      }),
      login: { pending: Boolean(login), last: lastLogin },
    };
  }

  async function reapply() {
    return (await reapplyConnectedHarnesses({ env, cfg: resolveConfig({ env }) })).map((row) => ({ id: row.id, ok: row.ok, error: row.error }));
  }

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    const appMatch = url.pathname.match(/^\/api\/apps\/([a-z]+)\/(connect|disconnect)$/);

    if (route === "GET /api/state") return sendJson(res, 200, state());

    if (route === "GET /api/models") {
      const cfg = resolveConfig({ env });
      if (!cfg.apiKey) return sendJson(res, 200, { models: [] });
      try {
        const data = await new CrizonClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, fetchImpl }).models();
        return sendJson(res, 200, { models: (Array.isArray(data?.data) ? data.data : []).map((row) => row?.id).filter(Boolean) });
      } catch (error) {
        return sendJson(res, 502, { error: error instanceof ApiError ? error.code : "network_error", status: error?.status ?? 0 });
      }
    }

    if (route === "POST /api/key") {
      const body = await readJson(req);
      const key = String(body?.key ?? "").trim();
      if (!key || key.length > 200 || /\s/.test(key)) return sendJson(res, 400, { error: "invalid_key" });
      const cfg = resolveConfig({ env });
      let verified = true;
      try {
        await new CrizonClient({ baseUrl: cfg.baseUrl, apiKey: key, fetchImpl }).models();
      } catch (error) {
        // Key bị Gateway từ chối thì không lưu; lỗi mạng vẫn lưu (giống `crizon-ai login`).
        if (error instanceof ApiError && error.status === 401) return sendJson(res, 400, { error: "invalid_key" });
        verified = false;
      }
      saveConfigFile({ ...loadConfigFile(env), apiKey: key }, env);
      return sendJson(res, 200, { verified, reapplied: await reapply(), state: state() });
    }

    if (route === "DELETE /api/key") {
      if (resolveConfig({ env }).source === "env") return sendJson(res, 409, { error: "env_key" });
      const { apiKey: _removed, ...rest } = loadConfigFile(env);
      saveConfigFile(rest, env);
      return sendJson(res, 200, { state: state() });
    }

    if (route === "POST /api/model") {
      const body = await readJson(req);
      const model = String(body?.model ?? "").trim();
      if (model.length > 128 || /[\r\n]/.test(model)) return sendJson(res, 400, { error: "invalid_model" });
      updateConfigFile({ model }, env);
      return sendJson(res, 200, { reapplied: await reapply(), state: state() });
    }

    if (appMatch && req.method === "POST") {
      const [, id, action] = appMatch;
      if (!HARNESSES[id]) return sendJson(res, 404, { error: "unknown_app" });
      const profilePath = profilePathFor(id);
      if (action === "disconnect") {
        await disconnectHarness({ id, env, profilePath, quiet: true });
        return sendJson(res, 200, { state: state() });
      }
      const cfg = resolveConfig({ env });
      if (!cfg.apiKey) return sendJson(res, 400, { error: "no_key" });
      try {
        const result = await applyHarness({ id, cfg, env, profilePath });
        return sendJson(res, 200, {
          result: { target: result.configFile?.path ?? result.profile?.path ?? result.envFile, backup: result.configFile?.backup ?? result.profile?.backup ?? null },
          state: state(),
        });
      } catch (error) {
        if (error instanceof CodexConfigConflict) return sendJson(res, 409, { error: "codex_conflict", path: HARNESSES.codex.configFile(env) });
        throw error;
      }
    }

    if (route === "POST /api/check") {
      const cfg = resolveConfig({ env });
      const gateway = { ok: false, count: 0, error: "no_key", status: 0 };
      if (cfg.apiKey) {
        try {
          const data = await new CrizonClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, fetchImpl }).models();
          Object.assign(gateway, { ok: true, count: Array.isArray(data?.data) ? data.data.length : 0, error: null, status: 200 });
        } catch (error) {
          Object.assign(gateway, { error: error instanceof ApiError ? error.code : "network_error", status: error?.status ?? 0 });
        }
      }
      const apps = {};
      for (const id of APP_ORDER.filter((name) => HARNESSES[name] && name !== "tui")) {
        const probe = await probeCompat(cfg.baseUrl, id, { timeoutMs: 4_000 });
        apps[id] = { supported: probe.supported, status: probe.status, path: new URL(probe.url).pathname };
      }
      return sendJson(res, 200, { gateway, apps });
    }

    if (route === "POST /api/login") {
      login = createLoginSession(`http://127.0.0.1:${actualPort}/callback`);
      lastLogin = null;
      return sendJson(res, 200, { url: authorizeUrl(resolveConfig({ env }).portalUrl, login) });
    }

    if (route === "GET /api/mcp") return sendJson(res, 200, listMcp(env));
    if (route === "POST /api/mcp") {
      const body = await readJson(req);
      addMcp(env, { name: body?.name, def: body?.def, apps: body?.apps }, { backups });
      return sendJson(res, 200, listMcp(env));
    }
    if (route === "POST /api/mcp/toggle") {
      const body = await readJson(req);
      setMcpApp(env, String(body?.name ?? ""), String(body?.app ?? ""), body?.on === true, { backups });
      return sendJson(res, 200, listMcp(env));
    }
    if (route === "POST /api/mcp/remove") {
      const body = await readJson(req);
      removeMcp(env, String(body?.name ?? ""), body?.app ? String(body.app) : null, { backups });
      return sendJson(res, 200, listMcp(env));
    }

    if (route === "GET /api/skills") return sendJson(res, 200, listSkills(env));
    if (route === "POST /api/skills/toggle") {
      const body = await readJson(req);
      setSkillApp(env, String(body?.dir ?? ""), String(body?.app ?? ""), body?.on === true);
      return sendJson(res, 200, listSkills(env));
    }
    if (route === "POST /api/skills/remove") {
      const body = await readJson(req);
      removeSkill(env, String(body?.dir ?? ""), body?.app ? String(body.app) : null);
      return sendJson(res, 200, listSkills(env));
    }
    if (route === "POST /api/skills/preview") {
      const body = await readJson(req);
      return sendJson(res, 200, await previewGithubSkill({ url: body?.url, env, fetchImpl: fetchImpl ?? fetch }));
    }
    if (route === "POST /api/skills/install") {
      const body = await readJson(req);
      const installed = await installGithubSkill({ source: body?.source, apps: body?.apps, env, fetchImpl: fetchImpl ?? fetch });
      return sendJson(res, 200, { installed, ...listSkills(env) });
    }

    if (route === "GET /api/catalog") {
      const kind = url.searchParams.get("kind") || "";
      return sendJson(res, 200, await fetchCatalog({ cfg: resolveConfig({ env }), env, tab: url.searchParams.get("tab") || "featured", kind: kind.toUpperCase(), q: url.searchParams.get("q") || "", fetchImpl: fetchImpl ?? fetch }));
    }
    if (route === "GET /api/catalog/item") {
      return sendJson(res, 200, await fetchCatalogItem({ cfg: resolveConfig({ env }), env, id: url.searchParams.get("id"), fetchImpl: fetchImpl ?? fetch }));
    }
    if (route === "POST /api/catalog/install") {
      const body = await readJson(req);
      const result = await installCatalogItem({ cfg: resolveConfig({ env }), env, id: body?.id, values: body?.values, apps: body?.apps, fetchImpl: fetchImpl ?? fetch, backups });
      return sendJson(res, 200, { installed: result });
    }

    if (route === "POST /api/quit") {
      sendJson(res, 200, { ok: true });
      setTimeout(() => server.close(() => finish()), 50);
      return undefined;
    }

    return sendJson(res, 404, { error: "not_found" });
  }

  async function callback(res, url) {
    const checked = readCallback(url, login);
    if (!checked.ok) {
      lastLogin = { ok: false, reason: checked.reason };
      login = null;
      return sendResultPage(res, resultPage({ ok: false, reason: checked.reason }));
    }
    try {
      const saved = await completeLogin({ env, code: checked.code, session: login, fetchImpl });
      login = null;
      const reapplied = await reapply();
      lastLogin = { ok: true, label: saved.label, lastFour: saved.lastFour, reapplied };
      return sendResultPage(res, resultPage({ ok: true, label: saved.label }));
    } catch (error) {
      login = null;
      lastLogin = { ok: false, reason: "exchange", detail: error?.message };
      return sendResultPage(res, resultPage({ ok: false, reason: "exchange", detail: error?.message }));
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || "");
      if (!origins().some((origin) => origin === `http://${host}`)) {
        res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden host");
        return;
      }
      const url = new URL(req.url || "/", `http://${host}`);
      const asset = STATIC[url.pathname];
      if (req.method === "GET" && asset) {
        res.writeHead(200, {
          "content-type": asset[1],
          "cache-control": "no-store",
          "content-security-policy": CSP,
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        });
        res.end(readFileSync(join(ASSETS, asset[0])));
        return;
      }
      if (req.method === "GET" && url.pathname === "/callback") {
        await callback(res, url);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const origin = req.headers.origin;
        if (origin && !origins().includes(origin)) return sendJson(res, 403, { error: "forbidden_origin" });
        if (!sameToken(req.headers.authorization, token)) return sendJson(res, 401, { error: "unauthorized" });
        if (req.method !== "GET" && req.method !== "DELETE" && !String(req.headers["content-type"] || "").startsWith("application/json")) {
          return sendJson(res, 415, { error: "json_required" });
        }
        await api(req, res, url);
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof McpError || error instanceof SkillError || error instanceof CatalogError) {
        sendJson(res, error.status, { error: error.code, app: error.app || undefined, path: error.path || undefined, detail: error.detail || undefined });
        return;
      }
      sendJson(res, error?.status ?? 500, { error: error?.message || "internal" });
    }
  });

  actualPort = await listenLoopback(server, port);
  const url = `http://127.0.0.1:${actualPort}/#t=${token}`;
  return {
    url,
    port: actualPort,
    token,
    closed,
    close: () => new Promise((resolve) => server.close(() => { finish(); resolve(); })),
  };
}

/** Lệnh `crizon-ai ui [--port N] [--no-open]`. */
export async function cmdUi({ flags = {}, env = process.env, io, open = openUrl } = {}) {
  const requested = flags.port === undefined ? UI_PORT : Number(flags.port);
  if (!Number.isInteger(requested) || requested < 0 || requested > 65535) {
    io.out("✗ --port");
    return 2;
  }
  const ui = await startUiServer({ env, port: requested });
  const { t } = await import("./i18n.mjs");
  const opened = flags["no-open"] ? false : Boolean(open(ui.url, { env }));
  io.out(t(opened ? "ui.opened" : "ui.open", { url: ui.url }));
  io.out(t("ui.stop"));
  const stop = () => ui.close();
  process.once("SIGINT", stop);
  await ui.closed;
  process.off("SIGINT", stop);
  io.out(t("ui.closed"));
  return 0;
}
