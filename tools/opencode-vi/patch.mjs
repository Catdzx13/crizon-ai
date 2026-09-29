#!/usr/bin/env node
/**
 * Việt hoá OpenCode TUI bằng "overlay" từ điển (idempotent).
 *
 *   node apps/ai-cli/tools/opencode-vi/patch.mjs           # áp từ điển vào source
 *   node apps/ai-cli/tools/opencode-vi/patch.mjs --check   # chỉ báo cáo, không ghi
 *   node apps/ai-cli/tools/opencode-vi/patch.mjs --restore # hoàn nguyên (git checkout)
 *
 * Mục từ điển có thể có phần tử thứ 3 = tiền tố đường dẫn giới hạn
 * (vd ["Use ", "Dùng ", "packages/tui/src/"] để không đụng code như `serviceUse`).
 *
 * Source mặc định: reference/ai-clis/opencode (đổi bằng OPENCODE_SOURCE).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
export const SOURCE = process.env.OPENCODE_SOURCE || process.env.CRIZON_OPENCODE_SOURCE || join(REPO_ROOT, "reference", "ai-clis", "opencode");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const VI = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ";

function walk(dir, out) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

const occurrences = (text, part) => text.split(part).length - 1;
const normalize = (file) => file.replace(/\\/g, "/");

export function applyDictionary({ check = false, log = console.log } = {}) {
  const dict = JSON.parse(readFileSync(join(HERE, "strings.json"), "utf8"));
  const files = [];
  for (const rel of dict.scope) walk(join(SOURCE, rel), files);
  const original = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
  const current = new Map(original);
  const stats = dict.replacements.map(([en, vi, scope]) => ({ en, vi, scope, count: 0, applied: 0 }));
  for (const stat of stats) {
    const targets = stat.scope
      ? [...original.keys()].filter((file) => normalize(file).includes(stat.scope))
      : [...original.keys()];
    for (const file of targets) {
      stat.count += occurrences(original.get(file), stat.en);
      stat.applied += occurrences(original.get(file), stat.vi);
    }
    if (stat.count > 0) {
      for (const file of targets) current.set(file, current.get(file).split(stat.en).join(stat.vi));
    }
  }
  let changed = 0;
  for (const [file, text] of current) {
    if (original.get(file) === text) continue;
    changed += 1;
    if (!check) writeFileSync(file, text, "utf8");
  }
  log(`  source: ${SOURCE}`);
  log(`  ${check ? "sẽ sửa" : "đã sửa"}: ${changed} file (quét ${files.length} file .ts/.tsx)`);
  let missing = 0;
  for (const stat of stats) {
    if (stat.count > 0) {
      log(`  ✔ ${stat.count}x  ${JSON.stringify(stat.en)} → ${JSON.stringify(stat.vi)}${stat.scope ? ` [chỉ ${stat.scope}]` : ""}`);
    } else if (stat.applied > 0) {
      log(`  ✔ đã áp dụng ${stat.applied}x  ${JSON.stringify(stat.vi)}`);
    } else {
      missing += 1;
      log(`  ✘ 0 khớp: ${JSON.stringify(stat.en)}`);
    }
  }
  if (missing) log(`  ⚠ ${missing} mục không khớp (upstream đổi chuỗi?) — cập nhật strings.json`);

  // Kiểm tra gãy code: chữ Việt lọt vào dòng import hoặc vào identifier (vd serviceDùng)
  const importRe = new RegExp(`import[^\\n]*[${VI}]`);
  const identRe = new RegExp(`[a-z0-9_$][A-Z][A-Za-z_$]*[${VI}]`, "g");
  const damaged = [];
  for (const [file, text] of current) {
    const importHit = importRe.exec(text)?.[0];
    const identHits = text.match(identRe) ?? [];
    if (importHit || identHits.length) damaged.push({ file: normalize(file), importHit, identHits: identHits.slice(0, 3) });
  }
  if (damaged.length) {
    log(`  ✘ NGHI VẤN GÃY CODE: ${damaged.length} file`);
    for (const d of damaged.slice(0, 10)) {
      log(`    - ${d.file}${d.importHit ? ` · import: ${JSON.stringify(d.importHit)}` : ""}${d.identHits.length ? ` · identifier: ${d.identHits.join(", ")}` : ""}`);
    }
  } else if (changed > 0 || check) {
    log("  ✔ không phát hiện chữ Việt lọt vào import/identifier");
  }
  return { changed, missing, damaged, stats };
}

function restore() {
  const targets = ["packages/tui/src", "packages/opencode/src"];
  execFileSync("git", ["-C", SOURCE, "checkout", "--", ...targets], { stdio: "inherit" });
  console.log("✓ đã hoàn nguyên source về bản gốc (git checkout)");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain) {
  const check = process.argv.includes("--check");
  if (process.argv.includes("--restore")) restore();
  else {
    const result = applyDictionary({ check });
    process.exitCode = result.damaged.length && !check ? 2 : 0;
  }
}
