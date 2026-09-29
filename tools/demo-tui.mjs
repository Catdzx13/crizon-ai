#!/usr/bin/env node
/**
 * DEMO 1 LỆNH: mở TUI Crizon THẬT dùng API Crizon (mock).
 *   node apps/ai-cli/tools/demo-tui.mjs                 → TUI Crizon **việt hoá** (ưu tiên binary đã đóng gói; không có thì chạy source)
 *   node apps/ai-cli/tools/demo-tui.mjs --source        → ép chạy từ source đã vá
 *   node apps/ai-cli/tools/demo-tui.mjs --binary        → dùng bản nhị phân TUI Crizon cũ
 *   node apps/ai-cli/tools/demo-tui.mjs "xin chào"      → chạy 1 câu (không tương tác)
 *
 * Tự động: mở mock gateway → `crizon-ai setup opencode` với config/home/profile TẠM
 * (không đụng TUI Crizon hay cấu hình thật của bạn) → chạy `opencode --standalone`.
 * Thoát là tự dọn dẹp.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startMockGateway } from "./mock-gateway.mjs";
import { applyDictionary } from "./tui-vi/patch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "bin", "crizon-ai.mjs");

// Ưu tiên bản opencode-ai (sst 1.18.x) đã cài riêng — bản này hỗ trợ plugin thương hiệu TUI.
// Đặt CRIZON_TUI_BIN để trỏ binary TUI khác (mặc định: bản cài cũ trong ~/crizon-opencode).
const brandedCandidate = process.env.CRIZON_TUI_BIN || process.env.CRIZON_OPENCODE_BIN
  || join(process.env.USERPROFILE || homedir(), "crizon-opencode", "opencode.cmd");
const opencodeBin = existsSync(brandedCandidate) ? brandedCandidate : "opencode";
const opencodeCommand = opencodeBin.includes(" ") ? `"${opencodeBin}"` : opencodeBin;

// shell:true là cách chạy `opencode` (.cmd) trên Windows; dập cảnh báo DEP0190 cho gọn.
process.removeAllListeners("warning");
process.on("warning", () => undefined);

const rawArgs = process.argv.slice(2);
let lang = "vi"; // demo mặc định tiếng Việt; đổi bằng --lang en
const langIndex = rawArgs.indexOf("--lang");
if (langIndex >= 0) {
  lang = rawArgs[langIndex + 1] || lang;
  rawArgs.splice(langIndex, 2);
}
const keep = rawArgs.includes("--keep");
if (keep) rawArgs.splice(rawArgs.indexOf("--keep"), 1);
const viFlag = rawArgs.includes("--vi");
if (viFlag) rawArgs.splice(rawArgs.indexOf("--vi"), 1);
const binaryFlag = rawArgs.includes("--binary");
if (binaryFlag) rawArgs.splice(rawArgs.indexOf("--binary"), 1);
const sourceFlag = rawArgs.includes("--source");
if (sourceFlag) rawArgs.splice(rawArgs.indexOf("--source"), 1);

// Tìm preload của @opentui/solid — plugin chuyển solid-js sang bản client (không phải server)
// và transform JSX kiểu Solid. Bắt buộc khi chạy TUI Crizon từ ngoài repo (xem bunfig.toml của họ).
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

// Nguồn TUI Crizon đã việt hoá ưu tiên: binary đã đóng gói > source đã cài > nhị phân upstream.
// Đổi bằng: CRIZON_TUI_BIN / CRIZON_TUI_SOURCE / --source / --binary.
const repoRoot = join(here, "..", "..", "..");
const viDir = process.env.CRIZON_TUI_SOURCE || process.env.CRIZON_OPENCODE_SOURCE || join(repoRoot, "reference", "ai-clis", "opencode");
const viEntry = join(viDir, "packages", "opencode", "src", "index.ts");
const viPreload = findOpenTuiPreload(viDir);
const viEnv = (process.env.CRIZON_TUI_VI ?? process.env.CRIZON_OPENCODE_VI ?? "").toLowerCase();
const viWanted = viFlag || viEnv === "" || viEnv === "1" || viEnv === "true";
const viReady = existsSync(viEntry) && existsSync(join(viDir, "node_modules")) && Boolean(viPreload);

// Binary việt hoá đã đóng gói: tools/build-tui.mjs → apps/ai-cli/dist/opencode/<os>-<arch>/
const platformDir = process.platform === "win32" ? "windows" : process.platform;
const exeName = process.platform === "win32" ? "crizon-tui.exe" : "crizon-tui";
const legacyExeName = process.platform === "win32" ? "opencode.exe" : "opencode";
const viBinDefault = [
  join(here, "..", "dist", "tui", `${platformDir}-${process.arch}`, exeName),
  join(here, "..", "dist", "opencode", `${platformDir}-${process.arch}`, legacyExeName),
].find((path) => existsSync(path)) ?? "";
const viBinEnv = process.env.CRIZON_TUI_BIN || process.env.CRIZON_OPENCODE_VI_BIN || "";
const viBin = viBinEnv && existsSync(viBinEnv) ? viBinEnv : existsSync(viBinDefault) ? viBinDefault : "";

let mode = "upstream";
if (!binaryFlag) {
  if (sourceFlag) mode = "vi-source";
  else if (viWanted && viBin) mode = "vi-bin";
  else if (viWanted && viReady) mode = "vi-source";
}
if (sourceFlag && !viReady) {
  console.error("✗ --source nhưng bản source việt hoá chưa sẵn sàng.");
  console.error(`  → cd "${viDir}" && bun install`);
  process.exit(1);
}
if (viFlag && mode === "upstream") {
  console.error("✗ --vi nhưng chưa có bản việt hoá (chưa đóng gói binary và chưa cài source).");
  console.error("  → node apps/ai-cli/tools/build-tui.mjs");
  process.exit(1);
}
if (mode === "upstream" && viWanted && !binaryFlag) {
  process.stdout.write("  (chưa có bản việt hoá — dùng nhị phân; muốn bật: node apps/ai-cli/tools/build-tui.mjs)\n");
}
const viSource = mode === "vi-source";
const viBinMode = mode === "vi-bin";

const mock = await startMockGateway({ port: 0, quiet: true });
const dir = mkdtempSync(join(tmpdir(), "crizon-opencode-demo-"));
const isV2 = mode === "upstream" && opencodeBin === "opencode"; // @opencode/cli v2 dùng --standalone và DB riêng; opencode-ai 1.18 thì không
const env = {
  ...process.env,
  CRIZON_BASE_URL: mock.baseUrl,
  CRIZON_API_KEY: "czn_demo_key_1234567890",
  CRIZON_CONFIG_PATH: join(dir, "config.json"),
  CRIZON_HOME: join(dir, "home"),
  CRIZON_PROFILE_PATH: join(dir, "profile.ps1"),
  CRIZON_LANG: lang,
  // Cô lập dữ liệu cho bản 1.18 (khỏi DB của bản v2 và plugin global).
  ...(isV2
    ? {}
    : {
      XDG_DATA_HOME: join(dir, "xdg-data"),
      XDG_CONFIG_HOME: join(dir, "xdg-config"),
    }),
};

const cleanup = async () => {
  await mock.close().catch(() => undefined);
  if (keep) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};

const LANG = String(lang || "vi").toLowerCase().slice(0, 2);
const TXT = {
  vi: { start: (bin, url, hint) => `\n  demo TUI Crizon · ${bin} · API Crizon (mock ${url})${hint}\n`, brand: (path) => `  brand plugin: ${path}\n\n`, diag: "\n  — chẩn đoán plugin TUI Crizon (log) —\n", end: (keep, dir) => `\n  demo kết thúc — ${keep ? `giữ thư mục tạm: ${dir}` : "đã dọn dẹp (config tạm đã xoá)"}.\n` },
  en: { start: (bin, url, hint) => `\n  demo TUI Crizon · ${bin} · Crizon API (mock ${url})${hint}\n`, brand: (path) => `  brand plugin: ${path}\n\n`, diag: "\n  — TUI Crizon plugin diagnostics (log) —\n", end: (keep, dir) => `\n  demo finished — ${keep ? `kept temp dir: ${dir}` : "cleaned up (temp config removed)"}.\n` },
};
const copy = TXT[LANG] ?? TXT.vi;

/** Đọc log TUI Crizon (cô lập trong thư mục tạm) để biết plugin có load hay lỗi. */
function pluginDiagnostics() {
  const logDir = join(dir, "xdg-data", "opencode", "log");
  const lines = [];
  try {
    for (const file of readdirSync(logDir)) {
      if (!file.endsWith(".log")) continue;
      for (const line of readFileSync(join(logDir, file), "utf8").split(/\r?\n/)) {
        if (/crizon|plugin|tui\.json|brand/i.test(line)) lines.push(line);
      }
    }
  } catch {
    /* ignore */
  }
  return lines.slice(-15);
}

function setupOpencode() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "setup", "opencode"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const setup = await setupOpencode();
const configPath = join(dir, "home", "harness", "opencode.json");
const tuiConfigPath = join(dir, "home", "harness", "opencode-tui.json");
if (setup.code !== 0 || !existsSync(configPath)) {
  process.stdout.write(setup.out);
  console.error("✗ setup opencode thất bại");
  await cleanup();
  process.exit(1);
}

const extra = rawArgs;
const viMode = viSource || viBinMode;
const opencodeArgs = viMode
  ? (extra.length ? ["run", ...extra] : [])
  : isV2
    ? (extra.length ? ["run", ...extra, "--standalone"] : ["--standalone"])
    : (extra.length ? ["run", ...extra] : []);
const interactive = extra.length === 0;

if (viSource) {
  const patched = applyDictionary({ log: () => undefined });
  if (patched.damaged.length) {
    console.error("✗ Việt hoá phát hiện nghi vấn gãy code — dừng cho an toàn.");
    console.error("  → node apps/ai-cli/tools/tui-vi/patch.mjs --restore");
    await cleanup();
    process.exit(1);
  }
}

const binLabel = viBinMode ? `TUI Crizon (binary${viBinEnv ? " · CRIZON_TUI_BIN" : ""})` : viSource ? "TUI Crizon (từ source)" : opencodeBin;
const HINTS = { vi: " · thoát bằng Ctrl+C hoặc /exit", en: " · quit with Ctrl+C or /exit" };
process.stdout.write(copy.start(binLabel, mock.baseUrl, interactive ? (HINTS[LANG] ?? HINTS.vi) : ""));
process.stdout.write(copy.brand(join(dir, "home", "harness", "opencode-brand.tsx")));

const spawnEnv = { ...env, OPENCODE_CONFIG: configPath, OPENCODE_TUI_CONFIG: tuiConfigPath };
const child = viSource
  // --preload: plugin @opentui/solid (Solid bản client + transform JSX) — bắt buộc khi chạy ngoài repo.
  // --jsx-import-source: Bun mặc định JSX kiểu React; TUI Crizon dùng Solid.
  ? spawn("bun", [`--preload=${viPreload}`, "--jsx-import-source=@opentui/solid", viEntry, ...(extra.length ? ["run", ...extra] : [])], {
      env: spawnEnv,
      cwd: dir,
      stdio: "inherit",
    })
  : viBinMode
    ? spawn(viBin, opencodeArgs, { env: spawnEnv, cwd: dir, stdio: "inherit" })
    : spawn(opencodeCommand, opencodeArgs, {
        env: spawnEnv,
        cwd: dir,
        stdio: "inherit",
        shell: true,
      });
child.on("error", (error) => {
  console.error(
    viSource
      ? `✗ Không chạy được bun: ${error.message}\n  → cài Bun 1.3+: https://bun.sh`
      : viBinMode
        ? `✗ Không chạy được binary việt hoá: ${error.message}\n  → đóng gói lại: node apps/ai-cli/tools/build-tui.mjs`
        : `✗ Không chạy được opencode: ${error.message}\n  → cài bằng: npm i -g opencode-ai`,
  );
});
const code = await new Promise((resolve) => child.on("close", resolve));

const diagnostics = pluginDiagnostics();
if (diagnostics.length) {
  process.stdout.write(copy.diag);
  for (const line of diagnostics) process.stdout.write(`  ${line.slice(0, 220)}\n`);
}

await cleanup();
process.stdout.write(copy.end(keep, dir));
process.exitCode = typeof code === "number" ? code : 0;
