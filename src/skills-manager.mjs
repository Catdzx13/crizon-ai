/**
 * Quản lý skill (thư mục chứa SKILL.md) cho Claude Code (~/.claude/skills) và Codex (~/.codex/skills).
 *
 * - Tắt = chuyển thư mục sang ~/.crizon-ai/skills-off/<app>/, bật lại = chuyển về (một cách cho cả 2 app).
 * - Bật ở app chưa có = chép skill từ app kia (cùng định dạng SKILL.md).
 * - Xoá = chuyển vào ~/.crizon-ai/trash/skills/ (lấy lại được).
 * - Cài từ GitHub: ghim commit SHA, liệt kê file để người dùng xác nhận rồi mới ghi.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

import { homeDir } from "./config.mjs";
import { claudeConfigDir, userHome } from "./mcp-manager.mjs";

export const SKILL_DIR = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const MAX_FILES = 100;
const MAX_BYTES = 2 * 1024 * 1024;

export class SkillError extends Error {
  constructor(code, { status = 400, app = "", detail = "" } = {}) {
    super(code);
    this.name = "SkillError";
    this.code = code;
    this.status = status;
    this.app = app;
    this.detail = detail;
  }
}

export const SKILL_APPS = [
  { id: "claude", name: "Claude Code", root: (env) => claudeConfigDir(env) },
  { id: "codex", name: "Codex", root: (env) => env.CODEX_HOME || join(userHome(env), ".codex") },
];
const appById = (id) => SKILL_APPS.find((app) => app.id === id);
const skillsDir = (env, app) => join(app.root(env), "skills");
const offDir = (env, app) => join(homeDir(env), "skills-off", app.id);

/** Frontmatter `name`/`description` của SKILL.md (YAML đơn giản, 1 dòng/khoá). */
export function readFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^﻿/, ""));
  const out = {};
  if (!match) return out;
  const lines = match[1].split(/\r?\n/);
  lines.forEach((line, index) => {
    const pair = /^(name|description):\s*(.*)$/.exec(line);
    if (!pair) return;
    let value = pair[2].trim();
    // Khối nhiều dòng (`>`, `|`, hoặc để trống rồi thụt lề ở dòng sau).
    if (/^[>|][+-]?$/.test(value) || !value) {
      const more = [];
      for (let next = index + 1; next < lines.length && /^\s+\S/.test(lines[next]); next += 1) more.push(lines[next].trim());
      value = more.join(" ");
    }
    out[pair[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
  });
  return out;
}

function skillsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SKILL_DIR.test(entry.name) && existsSync(join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

function meta(dir) {
  try {
    return readFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
  } catch {
    return {};
  }
}

/** Mọi skill trên máy: { apps, skills: [{ dir, name, description, apps: {id: on|off|absent|missing} }] }. */
export function listSkills(env = process.env) {
  const apps = SKILL_APPS.map((app) => ({ id: app.id, name: app.name, path: skillsDir(env, app), present: existsSync(app.root(env)) }));
  const found = new Map();
  for (const app of SKILL_APPS) {
    for (const [state, base] of [["on", skillsDir(env, app)], ["off", offDir(env, app)]]) {
      for (const dir of skillsIn(base)) {
        if (!found.has(dir)) found.set(dir, { dir, ...meta(join(base, dir)), apps: {} });
        const row = found.get(dir);
        if (!row.apps[app.id]) row.apps[app.id] = state;
      }
    }
  }
  const skills = [...found.values()].sort((a, b) => a.dir.localeCompare(b.dir)).map((row) => ({
    dir: row.dir,
    name: row.name || row.dir,
    description: row.description || "",
    apps: Object.fromEntries(apps.map((app) => [app.id, row.apps[app.id] || (app.present ? "absent" : "missing")])),
  }));
  return { apps, skills };
}

function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function requireApp(env, appId) {
  const app = appById(appId);
  if (!app) throw new SkillError("unknown_app", { status: 404 });
  if (!existsSync(app.root(env))) throw new SkillError("app_missing", { status: 409, app: appId });
  return app;
}

function locate(env, dir) {
  for (const app of SKILL_APPS) {
    for (const base of [skillsDir(env, app), offDir(env, app)]) if (existsSync(join(base, dir, "SKILL.md"))) return join(base, dir);
  }
  return null;
}

/** Bật/tắt skill cho một app; bật ở app chưa có = chép từ app khác. */
export function setSkillApp(env, dir, appId, on) {
  if (!SKILL_DIR.test(dir)) throw new SkillError("invalid_name");
  const app = requireApp(env, appId);
  const live = join(skillsDir(env, app), dir);
  const parked = join(offDir(env, app), dir);
  const isOn = existsSync(join(live, "SKILL.md"));
  const isOff = existsSync(join(parked, "SKILL.md"));
  if (on) {
    if (isOn) return;
    if (existsSync(live)) throw new SkillError("exists", { status: 409, app: appId });
    if (isOff) return move(parked, live);
    const source = locate(env, dir);
    if (!source) throw new SkillError("not_found", { status: 404 });
    mkdirSync(dirname(live), { recursive: true });
    cpSync(source, live, { recursive: true });
    return;
  }
  if (!isOn) return;
  if (existsSync(parked)) move(parked, `${parked}-${Date.now()}`);
  move(live, parked);
}

/** Xoá skill khỏi một app hoặc mọi app — chuyển vào thùng rác của Crizon. */
export function removeSkill(env, dir, appId = null) {
  if (!SKILL_DIR.test(dir)) throw new SkillError("invalid_name");
  const apps = appId ? [requireApp(env, appId)] : SKILL_APPS;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let removed = 0;
  for (const app of apps) {
    for (const base of [skillsDir(env, app), offDir(env, app)]) {
      const path = join(base, dir);
      if (!existsSync(path)) continue;
      move(path, join(homeDir(env), "trash", "skills", app.id, `${dir}-${stamp}`));
      removed += 1;
    }
  }
  if (!removed) throw new SkillError("not_found", { status: 404 });
}

/* ── Cài từ GitHub ────────────────────────────────────────────────── */

/** `https://github.com/<owner>/<repo>/tree/<ref>/<path>` (hoặc link tới SKILL.md). */
export function parseGithubSkillUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 5 || (parts[2] !== "tree" && parts[2] !== "blob")) return null;
  const [owner, repo, , ref, ...rest] = parts;
  if (rest.at(-1) === "SKILL.md") rest.pop();
  const path = rest.join("/");
  if (!path || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || path.split("/").some((part) => part === ".." || part === "." || !part)) return null;
  return { owner, repo, ref, path };
}

async function github(fetchImpl, env, path) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "crizon-ai" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetchImpl(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new SkillError(res.status === 404 ? "github_not_found" : res.status === 403 || res.status === 429 ? "github_rate_limited" : "github_error", { status: 502, detail: String(res.status) });
  return res.json();
}

async function skillTree(fetchImpl, env, { owner, repo, sha, path }) {
  const tree = await github(fetchImpl, env, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const prefix = `${path}/`;
  const files = (tree.tree || []).filter((item) => item.type === "blob" && item.path.startsWith(prefix)).map((item) => ({ path: item.path.slice(prefix.length), size: Number(item.size) || 0 }));
  if (!files.some((file) => file.path === "SKILL.md")) throw new SkillError("no_skill_md", { status: 422 });
  if (tree.truncated || files.length > MAX_FILES || files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new SkillError("too_large", { status: 422 });
  if (files.some((file) => file.path.split("/").some((part) => part === ".." || part === "." || !part))) throw new SkillError("bad_path", { status: 422 });
  return files;
}

async function raw(fetchImpl, { owner, repo, sha, path }, file) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${posix.join(path, file).split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetchImpl(url, { headers: { "user-agent": "crizon-ai" } });
  if (!res.ok) throw new SkillError("github_error", { status: 502, detail: String(res.status) });
  return Buffer.from(await res.arrayBuffer());
}

/** Xem trước: ghim ref → commit SHA, danh sách file, tên/mô tả. Chưa ghi gì. */
export async function previewGithubSkill({ url, env = process.env, fetchImpl = fetch }) {
  const source = parseGithubSkillUrl(url);
  if (!source) throw new SkillError("invalid_url");
  const commit = await github(fetchImpl, env, `/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`);
  const sha = String(commit?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new SkillError("github_error", { status: 502 });
  const pinned = { owner: source.owner, repo: source.repo, sha, path: source.path };
  const files = await skillTree(fetchImpl, env, pinned);
  const info = readFrontmatter((await raw(fetchImpl, pinned, "SKILL.md")).toString("utf8"));
  const dir = source.path.split("/").at(-1);
  if (!SKILL_DIR.test(dir)) throw new SkillError("invalid_name");
  return { source: pinned, dir, name: info.name || dir, description: info.description || "", files };
}

/** Cài skill đã xem trước (đúng commit SHA) vào các app đã chọn. */
export async function installGithubSkill({ source, apps, env = process.env, fetchImpl = fetch }) {
  const pinned = { owner: String(source?.owner ?? ""), repo: String(source?.repo ?? ""), sha: String(source?.sha ?? ""), path: String(source?.path ?? "") };
  if (!/^[\w.-]+$/.test(pinned.owner) || !/^[\w.-]+$/.test(pinned.repo) || !/^[0-9a-f]{40}$/.test(pinned.sha) || !pinned.path || pinned.path.split("/").some((part) => part === ".." || part === "." || !part)) {
    throw new SkillError("invalid_source");
  }
  const dir = pinned.path.split("/").at(-1);
  if (!SKILL_DIR.test(dir)) throw new SkillError("invalid_name");
  const targets = [...new Set(Array.isArray(apps) ? apps : [])].map((id) => requireApp(env, id));
  if (!targets.length) throw new SkillError("no_apps");
  if (locate(env, dir)) throw new SkillError("exists", { status: 409 });
  const files = await skillTree(fetchImpl, env, pinned);
  mkdirSync(homeDir(env), { recursive: true });
  const staging = mkdtempSync(join(homeDir(env), "skill-"));
  try {
    for (const file of files) {
      const target = join(staging, ...file.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, await raw(fetchImpl, pinned, file.path));
    }
    for (const app of targets) {
      const live = join(skillsDir(env, app), dir);
      mkdirSync(dirname(live), { recursive: true });
      cpSync(staging, live, { recursive: true });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { dir, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}
