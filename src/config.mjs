import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Base URL công khai của AI Gateway (đổi được bằng CRIZON_BASE_URL hoặc --base-url). */
export const DEFAULT_BASE_URL = "https://ai.crizonshop.com/v1";

/** Trang portal (tạo key) — đổi bằng CRIZON_PORTAL_URL hoặc --portal. */
export const DEFAULT_PORTAL_URL = "https://crizonshop.com/dashboard";

/** Thư mục dữ liệu cục bộ (sessions/logs/roles). Override bằng CRIZON_HOME (dùng cho test). */
export function homeDir(env = process.env) {
  return env.CRIZON_HOME || join(homedir(), ".crizon-ai");
}

export function configPath(env = process.env) {
  return env.CRIZON_CONFIG_PATH || join(homedir(), ".crizon-ai.json");
}

export function loadConfigFile(env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(configPath(env), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConfigFile(data, env = process.env) {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows không cần chmod */
  }
  return path;
}

/** Thứ tự ưu tiên: flag > env > file > mặc định. */
export function resolveConfig({ flags = {}, env = process.env } = {}) {
  const file = loadConfigFile(env);
  const apiKey = String(flags.key || env.CRIZON_API_KEY || file.apiKey || "").trim();
  const baseUrl = String(flags["base-url"] || env.CRIZON_BASE_URL || file.baseUrl || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const model = String(flags.model || env.CRIZON_MODEL || file.model || "").trim();
  const lang = String(flags.lang || env.CRIZON_LANG || file.lang || "").trim();
  const logo = String(flags.logo || env.CRIZON_LOGO || file.logo || "big").trim();
  const portalUrl = String(flags.portal || env.CRIZON_PORTAL_URL || file.portalUrl || DEFAULT_PORTAL_URL)
    .trim()
    .replace(/\/+$/, "");
  const harness = String(file.harness || "").trim();
  const source = flags.key ? "flag" : env.CRIZON_API_KEY ? "env" : file.apiKey ? "file" : "none";
  return { apiKey, baseUrl, model, lang, logo, portalUrl, harness, source, configPath: configPath(env), file };
}

/** Ghi khoá vào file cấu hình (giữ các khoá khác). */
export function updateConfigFile(patch, env = process.env) {
  const file = loadConfigFile(env);
  const next = { ...file, ...patch };
  const path = saveConfigFile(next, env);
  return { file: next, path };
}
