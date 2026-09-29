#!/usr/bin/env node
/**
 * crizon-doctor.mjs — chẩn đoán kết nối Crizon trong TUI Crizon (menu `/crizon`).
 * Kiểm tra: config · provider/key · gateway `/models` · lệnh/agent goal · goal hiện tại · môi trường.
 * `--open`: ghi trang HTML trạng thái (local) rồi mở bằng trình duyệt mặc định (kiểu FCC Admin UI).
 * Zero dependency — Node ≥ 20. Tham chiếu ý tưởng `fcc-doctor` của free-claude-code (AGPL — không dùng code).
 *
 *   node crizon-doctor.mjs [--config <path>] [--open] [--page] [--page-path <file>]
 *   CRIZON_NO_BROWSER=1  → có --open cũng chỉ ghi trang, không mở trình duyệt (dùng cho test/CI)
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const openBrowser = argv.includes("--open");
const writePage = openBrowser || argv.includes("--page") || argv.includes("--html");
const pagePath = flagValue("--page-path") || join(tmpdir(), "crizon-status.html");

const home = process.env.CRIZON_HOME || join(process.env.USERPROFILE || process.env.HOME || "", ".crizon-ai");
const configPath = flagValue("--config") || process.env.OPENCODE_CONFIG || join(home, "harness", "tui.json");

const rows = [];
const ok = (label, detail = "") => rows.push(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail = "") => rows.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
const info = (label, detail = "") => rows.push(`• ${label}${detail ? ` — ${detail}` : ""}`);

let config = null;
if (!existsSync(configPath)) {
  bad("Config", `không thấy ${configPath}`);
} else {
  try {
    config = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
    ok("Config", configPath);
  } catch (error) {
    bad("Config", `JSON lỗi: ${error?.message ?? error}`);
  }
}

if (config) {
  const provider = config.provider?.crizon;
  const options = provider?.options ?? {};
  const models = provider?.models ?? {};
  const modelCount = Object.keys(models).length;

  if (provider) ok("Provider crizon", `model mặc định: ${config.model ?? "(chưa đặt)"}`);
  else bad("Provider crizon", "thiếu khối provider.crizon");

  if (provider) ok("Model khả dụng", `${modelCount} model trong config`);
  ok("Lệnh /goal", config.command?.goal ? "đã cấu hình" : "thiếu (chạy lại: crizon-ai setup tui)");
  ok("Lệnh /crizon", config.command?.crizon ? "đã cấu hình" : "thiếu");
  ok("Agent goal-runner", config.agent?.["goal-runner"] ? "đã cấu hình" : "thiếu");
  info("Share", config.share === "disabled" ? "đã tắt (an toàn)" : `đang là "${config.share}"`);

  const key = typeof options.apiKey === "string" ? options.apiKey : "";
  if (key) ok("API key", `${key.slice(0, 8)}…${key.slice(-4)}`);
  else bad("API key", "thiếu apiKey trong provider options");

  const base = typeof options.baseURL === "string" ? options.baseURL.replace(/\/+$/, "") : "";
  if (!base) {
    bad("Gateway", "thiếu baseURL");
  } else {
    const headers = key ? { "x-api-key": key, authorization: `Bearer ${key}` } : {};
    try {
      const response = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        const count = Array.isArray(body?.data) ? body.data.length : 0;
        ok("Gateway /models", `${response.status} · ${count} model`);
      } else {
        bad("Gateway /models", `HTTP ${response.status}`);
      }
    } catch (error) {
      bad("Gateway", `${base} không kết nối được (${error?.name ?? "lỗi mạng"})`);
    }
  }
}

const goalPath = join(process.cwd(), ".crizon", "goal.json");
if (existsSync(goalPath)) {
  try {
    const goal = JSON.parse(readFileSync(goalPath, "utf8").replace(/^\uFEFF/, ""));
    const review = goal.review && !goal.planApproved ? " · CHƯA duyệt kế hoạch" : "";
    info("Goal hiện tại", `${goal.objective ?? "?"} · ${goal.status}${review}`);
  } catch {
    bad("Goal", "goal.json không đọc được");
  }
} else {
  info("Goal", "chưa có mục tiêu trong dự án này");
}

info("Node", process.version);
info("Thư mục dự án", process.cwd());

if (writePage) {
  writeFileSync(pagePath, renderPage(rows, { configPath }), "utf8");
  let opened = false;
  if (openBrowser && !process.env.CRIZON_NO_BROWSER) {
    opened = openFile(pagePath);
  }
  info(
    "Trang trạng thái",
    `${pagePath}${opened ? " (đã mở trong trình duyệt)" : openBrowser ? " (chưa mở — CRIZON_NO_BROWSER=1?)" : " (chỉ ghi trang)"}`,
  );
}

console.log("Chẩn đoán Crizon:");
for (const row of rows) console.log(`  ${row}`);

function openFile(file) {
  const platform = process.platform;
  const command =
    platform === "win32" ? ["cmd", ["/c", "start", "", file]] : platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderPage(items, meta) {
  const rendered = items
    .map((row) => {
      const color = row.startsWith("✓") ? "#34d399" : row.startsWith("✗") ? "#f87171" : "#94a3b8";
      return `<li style="color:${color}">${escapeHtml(row)}</li>`;
    })
    .join("\n        ");
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Crizon — Trạng thái kết nối</title>
  <style>
    body { margin: 0; padding: 40px; background: #0b1220; color: #e2e8f0; font: 15px/1.7 ui-monospace, Consolas, monospace; }
    h1 { font-size: 20px; margin: 0 0 4px; color: #7dd3fc; }
    .meta { color: #64748b; margin-bottom: 24px; }
    ul { list-style: none; padding: 0; max-width: 900px; }
    li { padding: 6px 10px; border-bottom: 1px solid #1e293b; white-space: pre-wrap; word-break: break-all; }
    footer { margin-top: 24px; color: #64748b; }
  </style>
</head>
<body>
  <h1>CRIZON AI — Trạng thái kết nối</h1>
  <div class="meta">Lúc ${escapeHtml(new Date().toISOString())} · config: ${escapeHtml(meta.configPath)}</div>
  <ul>
        ${rendered}
  </ul>
  <footer>Chạy lại <b>/crizon</b> trong TUI Crizon để cập nhật trang này.</footer>
</body>
</html>
`;
}
