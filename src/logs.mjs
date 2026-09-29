/** Log cục bộ dạng JSONL: ~/.crizon-ai/logs.jsonl (không chứa key). */
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { homeDir } from "./config.mjs";

export function logsPath(env) {
  return join(homeDir(env), "logs.jsonl");
}

/** entry: { ts, kind: "ask"|"chat", model, prompt, content, usage } */
export function appendLog(env, entry) {
  const file = logsPath(env);
  mkdirSync(dirname(file), { recursive: true });
  const safe = {
    ts: entry.ts || new Date().toISOString(),
    kind: entry.kind || "ask",
    model: entry.model || "",
    prompt: String(entry.prompt ?? "").slice(0, 500),
    content: String(entry.content ?? "").slice(0, 500),
    usage: entry.usage ?? null,
  };
  appendFileSync(file, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
}

export function readLogs(env, limit = 20) {
  try {
    const lines = readFileSync(logsPath(env), "utf8").split("\n").filter(Boolean);
    const out = [];
    for (const line of lines.slice(-Math.max(1, limit))) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* bỏ dòng hỏng */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function clearLogs(env) {
  try {
    rmSync(logsPath(env));
    return true;
  } catch {
    return false;
  }
}
