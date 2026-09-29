#!/usr/bin/env node
/**
 * Chạy TUI Crizon **từ source đã việt hoá** với gateway Crizon (không cần build binary).
 *
 *   node apps/ai-cli/tools/tui-vi/run.mjs              # demo: mock gateway + config tạm (cô lập)
 *   node apps/ai-cli/tools/tui-vi/run.mjs "xin chào"   # chạy 1 câu (không tương tác)
 *   node apps/ai-cli/tools/tui-vi/run.mjs --real       # dùng config/env thật + gateway thật
 *
 * Yêu cầu 1 lần: bun install trong source (script sẽ nhắc nếu thiếu).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockGateway } from "../mock-gateway.mjs";
import { applyDictionary, SOURCE } from "./patch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const CLI = join(REPO_ROOT, "apps", "ai-cli", "bin", "crizon-ai.mjs");
const PACKAGE_DIR = join(SOURCE, "packages", "opencode");

const rawArgs = process.argv.slice(2);
const real = rawArgs.includes("--real");
if (real) rawArgs.splice(rawArgs.indexOf("--real"), 1);

if (!existsSync(join(SOURCE, "node_modules"))) {
  console.error("✗ Chưa cài deps cho TUI Crizon source.");
  console.error(`  → cd "${SOURCE}" && bun install`);
  process.exit(1);
}

// Plugin @opentui/solid: chuyển solid-js sang bản client + transform JSX Solid.
// Không nạp là Solid rơi về bản server → "TuiStartupProvider is missing".
function findOpenTuiPreload(root) {
  const direct = join(root, "node_modules", "@opentui", "solid", "scripts", "preload.js");
  if (existsSync(direct)) return direct;
  try {
    for (const entry of readdirSync(join(root, "node_modules", ".bun"))) {
      if (!entry.startsWith("@opentui+solid@")) continue;
      const candidate = join(root, "node_modules", ".bun", entry, "node_modules", "@opentui", "solid", "scripts", "preload.js");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* ignore */
  }
  return null;
}
const PRELOAD = findOpenTuiPreload(SOURCE);
if (!PRELOAD) {
  console.error("✗ Thiếu @opentui/solid preload (deps chưa đủ?)");
  console.error(`  → cd "${SOURCE}" && bun install`);
  process.exit(1);
}

// 1) Áp từ điển việt hoá (idempotent)
console.log("→ việt hoá source TUI Crizon…");
applyDictionary();

// 2) Chuẩn bị môi trường
let mock = null;
let dir = null;
let env = { ...process.env };
let cwd = process.cwd();

if (!real) {
  mock = await startMockGateway({ port: 0, quiet: true });
  dir = mkdtempSync(join(tmpdir(), "opencode-vi-demo-"));
  env = {
    ...process.env,
    CRIZON_BASE_URL: mock.baseUrl,
    CRIZON_API_KEY: "czn_demo_key_1234567890",
    CRIZON_CONFIG_PATH: join(dir, "config.json"),
    CRIZON_HOME: join(dir, "home"),
    CRIZON_PROFILE_PATH: join(dir, "profile.ps1"),
    CRIZON_LANG: "vi",
    XDG_DATA_HOME: join(dir, "xdg-data"),
    XDG_CONFIG_HOME: join(dir, "xdg-config"),
  };
  cwd = dir;
  const setup = spawn(process.execPath, [CLI, "setup", "opencode"], { env, stdio: "ignore" });
  await new Promise((resolve) => setup.on("close", resolve));
  env.OPENCODE_CONFIG = join(dir, "home", "harness", "opencode.json");
  env.OPENCODE_TUI_CONFIG = join(dir, "home", "harness", "opencode-tui.json");
  console.log(`  demo · mock gateway ${mock.baseUrl} · config tạm (cô lập)`);
} else {
  const cfgFile = process.env.OPENCODE_CONFIG
    || join(env.CRIZON_HOME || join(process.env.USERPROFILE || "", ".crizon-ai"), "harness", "opencode.json");
  const tuiFile = process.env.OPENCODE_TUI_CONFIG
    || join(env.CRIZON_HOME || join(process.env.USERPROFILE || "", ".crizon-ai"), "harness", "opencode-tui.json");
  if (existsSync(cfgFile)) env.OPENCODE_CONFIG = cfgFile;
  if (existsSync(tuiFile)) env.OPENCODE_TUI_CONFIG = tuiFile;
  console.log("  thật · gateway/config theo cấu hình hiện tại");
}

console.log("  khởi động TUI Crizon (bun dev)…\n");

const child = spawn("bun", [`--preload=${PRELOAD}`, "--jsx-import-source=@opentui/solid", join(PACKAGE_DIR, "src", "index.ts"), ...(rawArgs.length ? ["run", ...rawArgs] : [])], {
  cwd,
  env,
  stdio: "inherit",
});
const code = await new Promise((resolve) => child.on("close", resolve));

if (mock) await mock.close().catch(() => undefined);
if (dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
process.exitCode = typeof code === "number" ? code : 0;
