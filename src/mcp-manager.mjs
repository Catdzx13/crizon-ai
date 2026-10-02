/**
 * Quản lý MCP server theo từng app (trang `crizon-ai ui`).
 *
 * - App JSON (`mcpServers`): Claude Code (~/.claude.json, user scope), Cursor, Claude Desktop, Gemini CLI, Qwen Code.
 * - Codex: bảng `[mcp_servers.<tên>]` trong config.toml — sửa theo dòng, giữ nguyên phần còn lại (comment, tools.*).
 * - Tắt: Codex dùng cờ gốc `enabled = false`; app không có cờ tắt thì cất định nghĩa vào kho của Crizon
 *   (`~/.crizon-ai/mcp-off.json`, 0600) rồi gỡ khỏi app, bật lại thì trả về nguyên vẹn.
 * - Luôn backup file trước khi sửa. Trang không bao giờ nhận giá trị env/header (chỉ tên).
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { codexConfigPath } from "./codex-config.mjs";
import { homeDir } from "./config.mjs";

export const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,100}$/;

export class McpError extends Error {
  constructor(code, { status = 400, path = "", app = "" } = {}) {
    super(code);
    this.name = "McpError";
    this.code = code;
    this.status = status;
    this.path = path;
    this.app = app;
  }
}

/** Thư mục người dùng (CRIZON_USER_HOME chỉ dùng cho test). */
export const userHome = (env = process.env) => env.CRIZON_USER_HOME || homedir();

export function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(userHome(env), ".claude");
}

function claudeDesktopConfig(env) {
  if (process.platform === "win32") return join(env.APPDATA && !env.CRIZON_USER_HOME ? env.APPDATA : join(userHome(env), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return join(userHome(env), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return join(userHome(env), ".config", "Claude", "claude_desktop_config.json");
}

/** Các app có MCP. `kinds`: loại server app đó chạy được. */
export const MCP_APPS = [
  {
    id: "claude",
    name: "Claude Code",
    kinds: ["stdio", "http", "sse"],
    path: (env) => (env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(userHome(env), ".claude.json")),
    present: (env, path) => existsSync(path) || existsSync(claudeConfigDir(env)),
  },
  { id: "codex", name: "Codex", kinds: ["stdio", "http"], path: (env) => codexConfigPath(env), present: (_env, path) => existsSync(dirname(path)) },
  { id: "cursor", name: "Cursor", kinds: ["stdio", "http", "sse"], path: (env) => join(userHome(env), ".cursor", "mcp.json"), present: (_env, path) => existsSync(dirname(path)) },
  { id: "claude-desktop", name: "Claude Desktop", kinds: ["stdio"], path: claudeDesktopConfig, present: (_env, path) => existsSync(dirname(path)) },
  { id: "gemini", name: "Gemini CLI", kinds: ["stdio", "http", "sse"], path: (env) => join(userHome(env), ".gemini", "settings.json"), present: (_env, path) => existsSync(dirname(path)) },
  { id: "qwen", name: "Qwen Code", kinds: ["stdio", "http", "sse"], path: (env) => join(userHome(env), ".qwen", "settings.json"), present: (_env, path) => existsSync(dirname(path)) },
];
const appById = (id) => MCP_APPS.find((app) => app.id === id);

/* ── File helpers ─────────────────────────────────────────────────── */

function backupOnce(path, backups) {
  if (!existsSync(path) || backups?.has(path)) return null;
  const backup = `${path}.crizon-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(path, backup);
  backups?.add(path);
  return backup;
}

function writePrivate(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows */
  }
}

const offPath = (env) => join(homeDir(env), "mcp-off.json");

function readOff(env) {
  try {
    const parsed = JSON.parse(readFileSync(offPath(env), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeOff(env, off) {
  for (const id of Object.keys(off)) if (!Object.keys(off[id]).length) delete off[id];
  writePrivate(offPath(env), `${JSON.stringify(off, null, 2)}\n`);
}

/* ── Định nghĩa chuẩn ↔ dạng của từng app ─────────────────────────── */

const strings = (value) => (Array.isArray(value) ? value.map(String) : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)])) : {});

/** JSON của app → { type, command, args, env } | { type, url, headers }. */
function fromJson(appId, raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.command) return { type: "stdio", command: String(raw.command), args: strings(raw.args), env: record(raw.env) };
  const url = raw.httpUrl || raw.url || raw.serverUrl;
  if (!url) return null;
  const sse = raw.type === "sse" || ((appId === "gemini" || appId === "qwen") && !raw.httpUrl);
  return { type: sse ? "sse" : "http", url: String(url), headers: record(raw.headers) };
}

function toJson(appId, def) {
  if (def.type === "stdio") {
    const out = appId === "claude" ? { type: "stdio", command: def.command, args: def.args } : { command: def.command, args: def.args };
    if (Object.keys(def.env).length) out.env = def.env;
    return out;
  }
  const headers = Object.keys(def.headers).length ? { headers: def.headers } : {};
  if (appId === "claude") return { type: def.type, url: def.url, ...headers };
  if ((appId === "gemini" || appId === "qwen") && def.type === "http") return { httpUrl: def.url, ...headers };
  return { url: def.url, ...headers };
}

/* ── App JSON ─────────────────────────────────────────────────────── */

function readJsonConfig(app, path) {
  if (!existsSync(path)) return { data: {}, text: "" };
  const text = readFileSync(path, "utf8");
  if (!text.trim()) return { data: {}, text };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not_object");
    return { data, text };
  } catch {
    throw new McpError("config_unreadable", { status: 409, path, app: app.id });
  }
}

function writeJsonConfig(path, { data, text }, backups) {
  const indent = text.match(/\n([ \t]+)"/)?.[1] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  backupOnce(path, backups);
  writePrivate(path, `${JSON.stringify(data, null, indent).replace(/\n/g, eol)}${eol}`);
}

/* ── Codex config.toml (đọc/sửa tối thiểu, theo dòng) ─────────────── */

/** Đọc giá trị TOML (chuỗi, số, bool, mảng, bảng nội tuyến) bắt đầu từ src[pos]. */
function tomlReader(src) {
  let i = 0;
  const fail = () => {
    throw new Error("toml_unsupported");
  };
  const skip = () => {
    while (i < src.length) {
      if (" \t\r\n".includes(src[i])) i += 1;
      else if (src[i] === "#") while (i < src.length && src[i] !== "\n") i += 1;
      else break;
    }
  };
  const skipInline = () => {
    while (i < src.length && " \t".includes(src[i])) i += 1;
  };
  function key() {
    skipInline();
    const parts = [];
    for (;;) {
      if (src[i] === '"' || src[i] === "'") parts.push(string());
      else {
        const match = /^[A-Za-z0-9_-]+/.exec(src.slice(i));
        if (!match) fail();
        parts.push(match[0]);
        i += match[0].length;
      }
      skipInline();
      if (src[i] !== ".") return parts;
      i += 1;
      skipInline();
    }
  }
  function string() {
    if (src.startsWith('"""', i) || src.startsWith("'''", i)) fail();
    const quote = src[i];
    let j = i + 1;
    while (j < src.length && src[j] !== quote && src[j] !== "\n") j += quote === '"' && src[j] === "\\" ? 2 : 1;
    if (src[j] !== quote) fail();
    const body = src.slice(i + 1, j);
    i = j + 1;
    if (quote === "'") return body;
    return JSON.parse(`"${body.replace(/\\U([0-9a-fA-F]{8})/g, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\e/g, "\\u001b")}"`);
  }
  function value() {
    skip();
    const ch = src[i];
    if (ch === '"' || ch === "'") return string();
    if (ch === "[") {
      i += 1;
      const out = [];
      for (;;) {
        skip();
        if (src[i] === "]") {
          i += 1;
          return out;
        }
        out.push(value());
        skip();
        if (src[i] === ",") i += 1;
        else if (src[i] !== "]") fail();
      }
    }
    if (ch === "{") {
      i += 1;
      const out = {};
      for (;;) {
        skipInline();
        if (src[i] === "}") {
          i += 1;
          return out;
        }
        const path = key();
        if (src[i] !== "=") fail();
        i += 1;
        setPath(out, path, value());
        skipInline();
        if (src[i] === ",") i += 1;
        else if (src[i] !== "}") fail();
      }
    }
    const word = /^[A-Za-z0-9_+.:-]+/.exec(src.slice(i))?.[0];
    if (!word) fail();
    i += word.length;
    if (word === "true" || word === "false") return word === "true";
    const number = Number(word.replace(/_/g, ""));
    return Number.isNaN(number) ? word : number;
  }
  /** Thân bảng: các dòng `key = value` → object. */
  function body() {
    const out = {};
    for (;;) {
      skip();
      if (i >= src.length) return out;
      const path = key();
      if (src[i] !== "=") fail();
      i += 1;
      setPath(out, path, value());
    }
  }
  return { key, body };
}

function setPath(target, path, value) {
  let node = target;
  for (const part of path.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[path.at(-1)] = value;
}

const HEADER = /^\s*\[(\[)?\s*(.+?)\s*\](\])?\s*(?:#.*)?$/;

/** Tách tiêu đề bảng: `[mcp_servers."a b".env]` → ["mcp_servers", "a b", "env"]. */
function headerPath(line) {
  const match = HEADER.exec(line);
  if (!match) return null;
  try {
    return { path: tomlReader(match[2]).key(), array: Boolean(match[1]) };
  } catch {
    return null;
  }
}

/** Các server trong config.toml: { name, start, end, mainStart, mainEnd, subs } (chỉ số dòng, end loại trừ). */
function codexServers(lines) {
  const headers = [];
  lines.forEach((line, index) => {
    if (!line.trimStart().startsWith("[")) return;
    const parsed = headerPath(line);
    if (parsed) headers.push({ index, ...parsed });
  });
  const lastContent = (from, to) => {
    let end = to;
    while (end > from && (!lines[end - 1].trim() || lines[end - 1].trim().startsWith("#"))) end -= 1;
    return end;
  };
  const servers = new Map();
  let server = null;
  headers.forEach((header, k) => {
    const next = k + 1 < headers.length ? headers[k + 1].index : lines.length;
    const { path } = header;
    if (header.array || path[0] !== "mcp_servers" || path.length < 2) {
      server = null;
      return;
    }
    const name = path[1];
    if (server?.name !== name) {
      // Bảng của cùng server nằm rời rạc (hiếm): chỉ quản lý khối đầu tiên.
      if (servers.has(name)) {
        server = null;
        return;
      }
      server = { name, start: header.index, end: header.index + 1, mainStart: -1, mainEnd: -1, subs: [] };
      servers.set(name, server);
    }
    server.end = lastContent(header.index + 1, next);
    if (path.length === 2) {
      server.mainStart = header.index;
      server.mainEnd = next;
    } else server.subs.push({ path: path.slice(2), start: header.index + 1, end: next });
  });
  return servers;
}

function readCodexServer(lines, server) {
  const parse = (from, to) => tomlReader(lines.slice(from, to).join("\n")).body();
  const main = server.mainStart >= 0 ? parse(server.mainStart + 1, server.mainEnd) : {};
  for (const sub of server.subs) {
    if (sub.path.length === 1 && (sub.path[0] === "env" || sub.path[0] === "http_headers")) main[sub.path[0]] = { ...record(main[sub.path[0]]), ...record(parse(sub.start, sub.end)) };
  }
  let def = null;
  if (main.command) def = { type: "stdio", command: String(main.command), args: strings(main.args), env: record(main.env) };
  else if (main.url) {
    const headers = record(main.http_headers);
    if (main.bearer_token_env_var) headers.Authorization = `Bearer \${${main.bearer_token_env_var}}`;
    def = { type: "http", url: String(main.url), headers };
  }
  return { def, enabled: main.enabled !== false };
}

const tomlString = (value) => JSON.stringify(String(value));
const tomlKey = (value) => (/^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value));

function renderCodexServer(name, def) {
  const base = `mcp_servers.${tomlKey(name)}`;
  const out = [`[${base}]`];
  if (def.type === "stdio") {
    out.push(`command = ${tomlString(def.command)}`, `args = [${def.args.map(tomlString).join(", ")}]`);
    if (Object.keys(def.env).length) out.push("", `[${base}.env]`, ...Object.entries(def.env).map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`));
  } else {
    out.push(`url = ${tomlString(def.url)}`);
    if (Object.keys(def.headers).length) out.push("", `[${base}.http_headers]`, ...Object.entries(def.headers).map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`));
  }
  return out;
}

function readCodexFile(path) {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  return { text, eol: text.includes("\r\n") ? "\r\n" : "\n", lines: text.replace(/\r\n/g, "\n").split("\n") };
}

function writeCodexFile(path, file, lines, backups) {
  while (lines.length > 1 && lines.at(-1) === "" && lines.at(-2) === "") lines.pop();
  if (lines.at(-1) !== "") lines.push("");
  backupOnce(path, backups);
  writePrivate(path, lines.join("\n").replace(/\n/g, file.eol));
}

/* ── Đọc trạng thái ───────────────────────────────────────────────── */

/** Server của 1 app: Map tên → { def, raw, on }. Ném McpError nếu file hỏng. */
function appEntries(env, app, off = readOff(env)) {
  const path = app.path(env);
  const entries = new Map();
  if (app.id === "codex") {
    const { lines } = readCodexFile(path);
    for (const server of codexServers(lines).values()) {
      try {
        const { def, enabled } = readCodexServer(lines, server);
        entries.set(server.name, { def, on: enabled });
      } catch {
        entries.set(server.name, { def: null, on: true });
      }
    }
    return entries;
  }
  const { data } = readJsonConfig(app, path);
  const servers = data.mcpServers && typeof data.mcpServers === "object" ? data.mcpServers : {};
  for (const [name, raw] of Object.entries(servers)) entries.set(name, { def: fromJson(app.id, raw), raw, on: true });
  for (const [name, raw] of Object.entries(off[app.id] || {})) if (!entries.has(name)) entries.set(name, { def: fromJson(app.id, raw), raw, on: false });
  return entries;
}

const SECRET_FLAG = /(key|token|secret|password|passwd|auth)/i;

/** Che tham số có vẻ là bí mật (token dài, `--api-key=...`, giá trị sau cờ `--token`). */
export function maskArgs(args) {
  return args.map((arg, index) => {
    const flagged = /^(--?[\w-]+)=(.*)$/.exec(arg);
    if (flagged && SECRET_FLAG.test(flagged[1])) return `${flagged[1]}=••••`;
    if (index > 0 && /^--?[\w-]+$/.test(args[index - 1]) && SECRET_FLAG.test(args[index - 1]) && !arg.startsWith("-")) return "••••";
    if (/^[A-Za-z0-9_-]{24,}$/.test(arg) && /\d/.test(arg) && /[A-Za-z]/.test(arg)) return "••••";
    return arg;
  });
}

function maskUrl(raw) {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "••••");
    url.username = "";
    url.password = "";
    return url.toString().replace(/%E2%80%A2/g, "•");
  } catch {
    return raw;
  }
}

/** Mô tả an toàn để gửi ra trang: không có giá trị env/header. */
export function summarizeDef(def) {
  if (!def) return { kind: "unknown" };
  if (def.type === "stdio") return { kind: "stdio", command: def.command, args: maskArgs(def.args), envKeys: Object.keys(def.env) };
  return { kind: def.type, url: maskUrl(def.url), headerKeys: Object.keys(def.headers) };
}

/** Toàn bộ MCP trên máy: { apps, servers }. Trạng thái theo app: on/off/absent/unsupported/missing/error. */
export function listMcp(env = process.env) {
  const off = readOff(env);
  const apps = [];
  const entriesByApp = new Map();
  for (const app of MCP_APPS) {
    const path = app.path(env);
    const row = { id: app.id, name: app.name, path, present: app.present(env, path), error: null };
    if (row.present) {
      try {
        entriesByApp.set(app.id, appEntries(env, app, off));
      } catch (error) {
        row.error = error instanceof McpError ? error.code : "config_unreadable";
      }
    }
    apps.push(row);
  }
  const names = new Set();
  for (const entries of entriesByApp.values()) for (const name of entries.keys()) names.add(name);
  const servers = [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
    const def = sourceDef(entriesByApp, name);
    const states = {};
    for (const app of MCP_APPS) {
      const row = apps.find((item) => item.id === app.id);
      const entry = entriesByApp.get(app.id)?.get(name);
      if (!row.present) states[app.id] = "missing";
      else if (row.error) states[app.id] = "error";
      else if (entry) states[app.id] = entry.on ? "on" : "off";
      else states[app.id] = def && !app.kinds.includes(def.type) ? "unsupported" : "absent";
    }
    return { name, summary: summarizeDef(def), apps: states };
  });
  return { apps, servers };
}

function sourceDef(entriesByApp, name) {
  for (const app of MCP_APPS) {
    const entry = entriesByApp.get(app.id)?.get(name);
    if (entry?.def) return entry.def;
  }
  return null;
}

/* ── Thao tác ─────────────────────────────────────────────────────── */

function requireApp(env, appId) {
  const app = appById(appId);
  if (!app) throw new McpError("unknown_app", { status: 404 });
  const path = app.path(env);
  if (!app.present(env, path)) throw new McpError("app_missing", { status: 409, app: appId, path });
  return { app, path };
}

function findDef(env, name) {
  const off = readOff(env);
  for (const app of MCP_APPS) {
    const path = app.path(env);
    if (!app.present(env, path)) continue;
    try {
      const def = appEntries(env, app, off).get(name)?.def;
      if (def) return def;
    } catch {
      /* bỏ qua app có file hỏng */
    }
  }
  return null;
}

function addToApp(env, app, path, name, def, backups) {
  if (!app.kinds.includes(def.type)) throw new McpError("unsupported_kind", { status: 409, app: app.id });
  if (app.id === "codex") {
    const file = readCodexFile(path);
    const lines = file.lines;
    while (lines.length && lines.at(-1) === "") lines.pop();
    if (lines.length) lines.push("");
    lines.push(...renderCodexServer(name, def), "");
    writeCodexFile(path, file, lines, backups);
    return;
  }
  const config = readJsonConfig(app, path);
  config.data.mcpServers = { ...(config.data.mcpServers || {}), [name]: toJson(app.id, def) };
  writeJsonConfig(path, config, backups);
}

/** Bật/tắt một server cho một app. Bật ở app chưa có = chép định nghĩa sang. */
export function setMcpApp(env, name, appId, on, { backups } = {}) {
  if (!MCP_NAME.test(name)) throw new McpError("invalid_name");
  const { app, path } = requireApp(env, appId);
  const off = readOff(env);
  const entry = appEntries(env, app, off).get(name);
  if (app.id === "codex") {
    if (!entry) {
      if (!on) return;
      const def = findDef(env, name);
      if (!def) throw new McpError("not_found", { status: 404 });
      addToApp(env, app, path, name, def, backups);
      return;
    }
    if (entry.on === on) return;
    const file = readCodexFile(path);
    const lines = file.lines;
    const server = codexServers(lines).get(name);
    if (server.mainStart < 0) {
      if (!on) lines.splice(server.start, 0, `[mcp_servers.${tomlKey(name)}]`, "enabled = false", "");
    } else {
      let flag = -1;
      for (let index = server.mainStart + 1; index < server.mainEnd; index += 1) if (/^\s*enabled\s*=/.test(lines[index])) flag = index;
      if (on && flag >= 0) lines.splice(flag, 1);
      else if (!on && flag >= 0) lines[flag] = "enabled = false";
      else if (!on) lines.splice(server.mainStart + 1, 0, "enabled = false");
    }
    writeCodexFile(path, file, lines, backups);
    return;
  }
  if (entry && entry.on === on) return;
  const config = readJsonConfig(app, path);
  const servers = { ...(config.data.mcpServers || {}) };
  if (on) {
    if (entry) {
      servers[name] = off[app.id][name];
      delete off[app.id][name];
    } else {
      const def = findDef(env, name);
      if (!def) throw new McpError("not_found", { status: 404 });
      if (!app.kinds.includes(def.type)) throw new McpError("unsupported_kind", { status: 409, app: app.id });
      servers[name] = toJson(app.id, def);
    }
  } else {
    if (!entry) return;
    off[app.id] = { ...(off[app.id] || {}), [name]: servers[name] };
    delete servers[name];
  }
  // Cất vào kho trước rồi mới gỡ khỏi app: lỗi giữa chừng không làm mất định nghĩa.
  writeOff(env, off);
  config.data.mcpServers = servers;
  writeJsonConfig(path, config, backups);
}

/** Xoá server khỏi một app (`appId`) hoặc khỏi mọi app (null). */
export function removeMcp(env, name, appId = null, { backups } = {}) {
  if (!MCP_NAME.test(name)) throw new McpError("invalid_name");
  const targets = appId ? [requireApp(env, appId)] : MCP_APPS.map((app) => ({ app, path: app.path(env) })).filter(({ app, path }) => app.present(env, path));
  const off = readOff(env);
  let removed = 0;
  for (const { app, path } of targets) {
    if (app.id === "codex") {
      const file = readCodexFile(path);
      const server = codexServers(file.lines).get(name);
      if (!server) continue;
      let start = server.start;
      while (start > 0 && !file.lines[start - 1].trim()) start -= 1;
      file.lines.splice(start, server.end - start);
      writeCodexFile(path, file, file.lines, backups);
      removed += 1;
      continue;
    }
    if (off[app.id]?.[name]) {
      delete off[app.id][name];
      removed += 1;
    }
    let config;
    try {
      config = readJsonConfig(app, path);
    } catch (error) {
      if (appId) throw error;
      continue;
    }
    if (config.data.mcpServers && name in config.data.mcpServers) {
      const { [name]: _gone, ...rest } = config.data.mcpServers;
      config.data.mcpServers = rest;
      writeJsonConfig(path, config, backups);
      removed += 1;
    }
  }
  writeOff(env, off);
  if (!removed) throw new McpError("not_found", { status: 404 });
}

/** Kiểm tra + chuẩn hoá định nghĩa do người dùng nhập. */
export function validateDef(input) {
  const type = input?.type;
  const text = (value, max) => {
    const out = String(value ?? "").trim();
    if (!out || out.length > max || /[\r\n\0]/.test(out)) throw new McpError("invalid_def");
    return out;
  };
  const pairs = (value, pattern) => {
    const out = {};
    const entries = Object.entries(value && typeof value === "object" ? value : {});
    if (entries.length > 50) throw new McpError("invalid_def");
    for (const [key, raw] of entries) {
      if (!pattern.test(key)) throw new McpError("invalid_def");
      const item = String(raw ?? "");
      if (item.length > 4000 || /[\r\n\0]/.test(item)) throw new McpError("invalid_def");
      out[key] = item;
    }
    return out;
  };
  if (type === "stdio") {
    const args = Array.isArray(input.args) ? input.args.map(String) : [];
    if (args.length > 50 || args.some((arg) => arg.length > 1000 || /[\r\n\0]/.test(arg))) throw new McpError("invalid_def");
    return { type, command: text(input.command, 300), args, env: pairs(input.env, ENV_NAME) };
  }
  if (type === "http" || type === "sse") {
    const url = text(input.url, 2000);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new McpError("invalid_def");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new McpError("invalid_def");
    return { type, url, headers: pairs(input.headers, HEADER_NAME) };
  }
  throw new McpError("invalid_def");
}

/** Thêm server mới vào các app đã chọn. */
export function addMcp(env, { name, def, apps }, { backups } = {}) {
  if (!MCP_NAME.test(String(name ?? ""))) throw new McpError("invalid_name");
  const clean = validateDef(def);
  const targets = [...new Set(Array.isArray(apps) ? apps : [])].map((id) => requireApp(env, id));
  if (!targets.length) throw new McpError("no_apps");
  for (const { app } of targets) if (!app.kinds.includes(clean.type)) throw new McpError("unsupported_kind", { status: 409, app: app.id });
  if (listMcp(env).servers.some((server) => server.name === name)) throw new McpError("exists", { status: 409 });
  for (const { app, path } of targets) addToApp(env, app, path, name, clean, backups);
}
