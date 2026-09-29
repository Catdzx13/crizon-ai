#!/usr/bin/env node
/**
 * Đóng gói TUI Crizon thành **1 file binary** (khách không cần Bun/source).
 *
 *   node apps/ai-cli/tools/build-tui.mjs                  # vá từ điển + build + copy artifact
 *   node apps/ai-cli/tools/build-tui.mjs --skip-install   # bỏ bun install cross-platform (nhanh)
 *   node apps/ai-cli/tools/build-tui.mjs --no-patch       # không áp lại từ điển
 *   node apps/ai-cli/tools/build-tui.mjs --out <dir>      # nơi copy (mặc định apps/ai-cli/dist/opencode/<os>-<arch>)
 *   node apps/ai-cli/tools/build-tui.mjs --json           # in JSON { path, out, size, version }
 *   node apps/ai-cli/tools/build-tui.mjs --no-copy        # chỉ build, không copy
 *
 * Sau khi xong: `node apps/ai-cli/tools/demo-tui.mjs` tự dùng binary này.
 * Kiểm tra tiếng Việt runtime: `node apps/ai-cli/tools/tui-vi/smoke-tui.mjs <binary> --palette`.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyDictionary, SOURCE } from "./tui-vi/patch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, "..");

const args = process.argv.slice(2);
const skipInstall = args.includes("--skip-install");
const noPatch = args.includes("--no-patch");
const noCopy = args.includes("--no-copy");
const asJson = args.includes("--json");
const outIndex = args.indexOf("--out");
const outArg = outIndex >= 0 ? args[outIndex + 1] : "";

if (args.includes("--help")) {
  console.log(`Dùng: node apps/ai-cli/tools/build-tui.mjs [--skip-install] [--no-patch] [--out <dir>] [--no-copy] [--json]

Quy trình: áp từ điển việt hoá (idempotent) → bun build (--single --skip-embed-web-ui)
→ kiểm tra --version → copy binary ra apps/ai-cli/dist/opencode/<os>-<arch>/.
Bun bắt buộc cho bước build; binary thành phẩm KHÔNG cần Bun khi chạy.`);
  process.exit(0);
}

const isWindows = process.platform === "win32";
const platformDir = isWindows ? "windows" : process.platform;
const exeName = isWindows ? "opencode.exe" : "opencode";
const outExeName = isWindows ? "crizon-tui.exe" : "crizon-tui";

if (!existsSync(join(SOURCE, "packages", "opencode", "script", "build.ts"))) {
  console.error(`✘ Không thấy source TUI Crizon tại ${SOURCE}`);
  console.error("  → chạy tools/fetch-ai-clis.ps1 hoặc đặt OPENCODE_SOURCE.");
  process.exit(2);
}

// 1) Từ điển việt hoá
if (!noPatch) {
  const result = applyDictionary({ log: () => undefined });
  console.log(`  từ điển: sửa ${result.changed} file · thiếu ${result.missing} mục · nghi vấn gãy ${result.damaged.length}`);
  if (result.damaged.length) {
    console.error("✘ Việt hoá phát hiện nghi vấn gãy code — dừng. Xem: node apps/ai-cli/tools/tui-vi/patch.mjs --check");
    process.exit(2);
  }
}

// 2) Build binary (chỉ máy hiện tại; bỏ Web UI nhúng cho nhẹ)
const pkgDir = join(SOURCE, "packages", "opencode");
const buildArgs = ["run", "script/build.ts", "--single", "--skip-embed-web-ui", ...(skipInstall ? ["--skip-install"] : [])];
console.log(`  build  : bun ${buildArgs.join(" ")}`);
const build = spawnSync("bun", buildArgs, { cwd: pkgDir, stdio: "inherit" });
if (build.status !== 0) {
  console.error(`✘ Build thất bại (exit ${build.status ?? "?"}).`);
  process.exit(1);
}

// 3) Tìm binary vừa build
const distDir = join(pkgDir, "dist");
const wanted = `opencode-${platformDir}-${process.arch}`;
let built = "";
try {
  const dirs = readdirSync(distDir).filter((name) => name.startsWith(`opencode-${platformDir}-${process.arch}`));
  for (const dir of dirs) {
    const candidate = join(distDir, dir, "bin", exeName);
    if (existsSync(candidate)) {
      built = candidate;
      break;
    }
  }
} catch {
  /* dist chưa có */
}
if (!built) {
  console.error(`✘ Không tìm thấy binary trong ${distDir} (mong đợi ${wanted}/bin/${exeName}).`);
  process.exit(1);
}

// 4) Smoke test --version
const version = spawnSync(built, ["--version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`✘ Binary không chạy được --version: ${(version.stderr || version.stdout || "").trim()}`);
  process.exit(1);
}
const sizeMb = (statSync(built).size / 1024 / 1024).toFixed(1);

// 5) Copy artifact
const outDir = outArg ? outArg : join(APP_DIR, "dist", "tui", `${platformDir}-${process.arch}`);
let outPath = "";
if (!noCopy) {
  mkdirSync(outDir, { recursive: true });
  outPath = join(outDir, outExeName);
  copyFileSync(built, outPath);
}

if (asJson) {
  console.log(JSON.stringify({ path: built, out: outPath || null, sizeMb: Number(sizeMb), version: version.stdout.trim() }, null, 2));
} else {
  console.log(`  xong   : ${built}  (${sizeMb} MB, ${version.stdout.trim()})`);
  if (outPath) console.log(`  copy   : ${outPath}`);
  console.log("  chạy   : node apps/ai-cli/tools/demo-tui.mjs   (launcher tự ưu tiên binary này)");
  console.log(`  smoke  : node apps/ai-cli/tools/tui-vi/smoke-tui.mjs "${outPath || built}" --palette`);
}
