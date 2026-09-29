/** Sessions chat cục bộ: ~/.crizon-ai/sessions/<name>.json */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { homeDir } from "./config.mjs";

function safeName(name) {
  const s = String(name || "default").trim();
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64) || "default";
}

export function sessionsDir(env) {
  return join(homeDir(env), "sessions");
}

export function sessionFile(env, name) {
  return join(sessionsDir(env), `${safeName(name)}.json`);
}

export function loadSession(env, name = "default") {
  try {
    const data = JSON.parse(readFileSync(sessionFile(env, name), "utf8"));
    return {
      name: safeName(name),
      model: typeof data.model === "string" ? data.model : "",
      messages: Array.isArray(data.messages) ? data.messages : [],
    };
  } catch {
    return { name: safeName(name), model: "", messages: [] };
  }
}

export function saveSession(env, session) {
  const name = safeName(session?.name);
  const dir = sessionsDir(env);
  mkdirSync(dir, { recursive: true });
  const file = sessionFile(env, name);
  writeFileSync(file, `${JSON.stringify({ name, model: session.model ?? "", messages: session.messages ?? [] }, null, 2)}\n`, { mode: 0o600 });
  return file;
}

export function listSessions(env) {
  try {
    return readdirSync(sessionsDir(env))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

export function clearSession(env, name = "default") {
  try {
    rmSync(sessionFile(env, name));
    return true;
  } catch {
    return false;
  }
}
