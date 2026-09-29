#!/usr/bin/env node
/**
 * Smoke test TUI thật trong pty (bắt màn hình) — kiểm tra binary TUI Crizon có tiếng Việt.
 *
 *   node apps/ai-cli/tools/tui-vi/smoke-tui.mjs <binary> [--palette] [--wait 7000] [--json]
 *
 * --palette: gửi Ctrl+P mở bảng lệnh để kiểm tra thêm chuỗi trong palette.
 * Cần @lydell/node-pty trong repo reference (node_modules) — dùng createRequire trỏ vào đó.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const OPENCODE_REPO = process.env.CRIZON_TUI_SOURCE || process.env.OPENCODE_SOURCE || join(REPO_ROOT, "reference", "ai-clis", "opencode");

const args = process.argv.slice(2);
const binary = args.find((a) => !a.startsWith("--"));
const waitIndex = args.indexOf("--wait");
const waitMs = waitIndex >= 0 ? Number(args[waitIndex + 1]) : 7000;
const palette = args.includes("--palette");
const asJson = args.includes("--json");

if (!binary) {
  console.error("Dùng: node smoke-tui.mjs <binary> [--palette] [--wait 7000] [--json]");
  process.exit(2);
}

const require = createRequire(join(OPENCODE_REPO, "package.json"));
const bunStore = join(OPENCODE_REPO, "node_modules", ".bun");
function loadPty() {
  try {
    return require("@lydell/node-pty");
  } catch {
    /* Bun store bên dưới */
  }
  const matches = readdirSync(bunStore).filter((name) => name.startsWith("@lydell+node-pty@"));
  for (const name of matches) {
    try {
      return require(join(bunStore, name, "node_modules", "@lydell", "node-pty"));
    } catch {
      /* thử tiếp */
    }
  }
  return null;
}
let pty;
try {
  pty = loadPty();
} catch (err) {
  console.error(`✘ Không nạp được node-pty: ${err.message}`);
  process.exit(2);
}
if (!pty) {
  console.error(`✘ Không tìm thấy @lydell/node-pty trong ${OPENCODE_REPO}`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "crizon-tui-smoke-"));
const binaryAbs = resolve(binary);
if (!existsSync(binaryAbs)) {
  console.error(`✘ Không thấy binary: ${binaryAbs}`);
  process.exit(2);
}
const stripAnsi = (s) =>
  s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][0-9A-Za-z]/g, "")
    .replace(/\r/g, "");

const chunks = [];
let term;
try {
  term = pty.spawn(binaryAbs, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 34,
    cwd: dir,
    env: {
      ...process.env,
      HOME: dir,
      USERPROFILE: dir,
      XDG_DATA_HOME: join(dir, "xdg-data"),
      XDG_CONFIG_HOME: join(dir, "xdg-config"),
      XDG_CACHE_HOME: join(dir, "xdg-cache"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      NO_COLOR: "1",
    },
  });
} catch (err) {
  console.error(`✘ Không khởi động được pty cho binary: ${err.message}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}
term.onData((data) => chunks.push(data));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const finish = (code) => {
  try {
    term.kill();
  } catch {
    /* ignore */
  }
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
};

try {
  await sleep(waitMs);
  if (palette) {
    term.write("\x10"); // Ctrl+P
    await sleep(2500);
    term.write("\x1b"); // Esc đóng palette
    await sleep(300);
  }
} finally {
  // đóng TUI: Ctrl+C (lần 2 để thoát nếu cần)
  try {
    term.write("\x03");
    await sleep(800);
    term.write("\x03");
    await sleep(800);
  } catch {
    /* ignore */
  }
}

const raw = chunks.join("");
const text = stripAnsi(raw);
const lines = text.split("\n").map((l) => l.trimEnd()).filter(Boolean);

const markers = {
  placeholder: "Hỏi bất cứ điều gì",
  tips: "Mẹo",
  paletteSuggested: "Gợi ý",
  paletteSession: "Đổi phiên",
  paletteNew: "Phiên mới",
  footerCommands: "ctrl+p lệnh",
  help: "Trợ giúp",
};
const found = {};
for (const [key, needle] of Object.entries(markers)) {
  found[key] = text.includes(needle);
}

if (asJson) {
  console.log(JSON.stringify({ binary, found, tail: lines.slice(-25) }, null, 2));
} else {
  console.log(`binary: ${binary}`);
  for (const [key, needle] of Object.entries(markers)) {
    console.log(`  ${found[key] ? "CO   " : "KHONG"}  ${key.padEnd(15)} "${needle}"`);
  }
  if (!found.placeholder && !found.tips) {
    console.log("\n— 25 dòng cuối màn hình (đã bỏ ANSI) —");
    for (const line of lines.slice(-25)) console.log(`  | ${line}`);
  }
}

const anyVi = found.placeholder || found.tips || found.paletteSuggested || found.footerCommands;
process.exitCode = anyVi ? 0 : 1;
finish(anyVi ? 0 : 1);
