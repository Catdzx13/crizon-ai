/**
 * Codex: provider "crizon" trong ~/.codex/config.toml (CODEX_HOME nếu có).
 *
 * Codex ≥ 0.15x bỏ qua OPENAI_BASE_URL/OPENAI_API_KEY, nên phải khai báo provider
 * trong config. Key nằm trong `experimental_bearer_token` → không cần biến môi
 * trường, app/IDE Codex (dùng chung file) cũng chạy qua Crizon.
 *
 * Ghi 2 khối marker: khối gốc ở ĐẦU file (khoá gốc TOML phải đứng trước mọi bảng)
 * và khối bảng provider ở CUỐI file. Dòng `model`/`model_provider`/`profile` gốc
 * của người dùng được tạm tắt bằng tiền tố, `removeCodexConfig` bật lại như cũ.
 * Luôn backup file trước khi sửa.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CODEX_TOP_BEGIN = "# >>> crizon-ai (codex) >>>";
export const CODEX_PROVIDER_BEGIN = "# >>> crizon-ai (codex-provider) >>>";
export const CODEX_END = "# <<< crizon-ai <<<";
export const CODEX_DISABLED = "# crizon-ai-disabled: ";
const ROOT_KEYS = ["model", "model_provider", "profile"];

export class CodexConfigConflict extends Error {
  constructor(path) {
    super(`${path} đã có [model_providers.crizon] do người dùng tự viết — gỡ bảng đó rồi chạy lại.`);
    this.name = "CodexConfigConflict";
    this.code = "codex_provider_conflict";
  }
}

export function codexConfigPath(env = process.env) {
  return join(env.CODEX_HOME || join(homedir(), ".codex"), "config.toml");
}

/** Chuỗi TOML cơ bản (escape kiểu JSON là hợp lệ trong TOML basic string). */
const tomlString = (value) => JSON.stringify(String(value));

function cutBlock(text, begin) {
  const start = text.indexOf(begin);
  if (start < 0) return text;
  const stop = text.indexOf(CODEX_END, start);
  if (stop < 0) return text;
  const rest = text.slice(stop + CODEX_END.length).replace(/^(\r?\n){1,2}/, "");
  return text.slice(0, start) + rest;
}

function stripBlocks(text) {
  return cutBlock(cutBlock(text, CODEX_TOP_BEGIN), CODEX_PROVIDER_BEGIN);
}

function restoreDisabled(text) {
  return text.split(CODEX_DISABLED).join("");
}

const TABLE_HEADER = /^\s*\[\[?[A-Za-z0-9_.\-"' ]+\]\]?\s*(#.*)?$/;

/** Tắt các khoá gốc (trước bảng đầu tiên) để khối Crizon là nguồn duy nhất. */
function disableRootKeys(text, eol) {
  const keyLine = new RegExp(`^\\s*(${ROOT_KEYS.join("|")})\\s*=`);
  let inRoot = true;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (TABLE_HEADER.test(line)) inRoot = false;
      return inRoot && keyLine.test(line) ? `${CODEX_DISABLED}${line}` : line;
    })
    .join(eol);
}

export function renderCodexBlocks(cfg, { model, eol = "\n" } = {}) {
  const top = [CODEX_TOP_BEGIN, 'model_provider = "crizon"', ...(model ? [`model = ${tomlString(model)}`] : []), CODEX_END].join(eol);
  const provider = [
    CODEX_PROVIDER_BEGIN,
    "[model_providers.crizon]",
    'name = "Crizon AI"',
    `base_url = ${tomlString(String(cfg.baseUrl || "").replace(/\/+$/, ""))}`,
    `experimental_bearer_token = ${tomlString(cfg.apiKey)}`,
    'wire_api = "responses"',
    CODEX_END,
  ].join(eol);
  return { top, provider };
}

function backupFile(path) {
  const backup = `${path}.crizon-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(path, backup);
  return backup;
}

/** Ghi (hoặc thay) cấu hình Crizon cho Codex. Trả { path, backup }. */
export function applyCodexConfig(cfg, { env = process.env, model = "" } = {}) {
  const path = codexConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const base = restoreDisabled(stripBlocks(current));
  if (/^\s*\[model_providers\.crizon\]/m.test(base)) throw new CodexConfigConflict(path);
  const backup = current.trim() ? backupFile(path) : null;
  const { top, provider } = renderCodexBlocks(cfg, { model, eol });
  const userPart = disableRootKeys(base, eol).replace(/\s+$/, "");
  const next = `${top}${eol}${eol}${userPart ? `${userPart}${eol}${eol}` : ""}${provider}${eol}`;
  writeFileSync(path, next, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows không cần chmod */
  }
  return { path, backup };
}

/** Gỡ cấu hình Crizon và bật lại các dòng gốc đã tạm tắt. */
export function removeCodexConfig({ env = process.env } = {}) {
  const path = codexConfigPath(env);
  if (!existsSync(path)) return { path, removed: false };
  const current = readFileSync(path, "utf8");
  if (!current.includes(CODEX_TOP_BEGIN) && !current.includes(CODEX_PROVIDER_BEGIN)) return { path, removed: false };
  const backup = backupFile(path);
  const next = restoreDisabled(stripBlocks(current)).replace(/\s+$/, "");
  writeFileSync(path, next ? `${next}${current.includes("\r\n") ? "\r\n" : "\n"}` : "", { mode: 0o600 });
  return { path, removed: true, backup };
}

export function hasCodexConfig(env = process.env) {
  try {
    return readFileSync(codexConfigPath(env), "utf8").includes(CODEX_PROVIDER_BEGIN);
  } catch {
    return false;
  }
}
