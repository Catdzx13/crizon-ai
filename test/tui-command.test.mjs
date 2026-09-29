import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { cmdTui, downloadTuiBinary, resolveTuiBinary, tuiBinaryCandidates, tuiDownloadUrl } from "../src/commands.mjs";
import { managedConfigFile, managedTuiConfigFile } from "../src/harness.mjs";

function makeIo() {
  const lines = [];
  return {
    io: {
      out: (line = "") => lines.push(String(line)),
      err: (line = "") => lines.push(String(line)),
      write: (text) => lines.push(String(text)),
    },
    lines,
  };
}

function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "crizon-tui-"));
  return { dir, env: { CRIZON_CONFIG_PATH: join(dir, "config.json"), CRIZON_HOME: join(dir, "home") } };
}

test("tui: chưa cài harness → nhắc setup (exit 2)", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { io, lines } = makeIo();
  const code = await cmdTui({ env, io });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /setup opencode/);
});

test("tui: thiếu binary → hướng dẫn đóng gói (exit 2)", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = managedConfigFile(env, "opencode");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, "{}");

  const { io, lines } = makeIo();
  const code = await cmdTui({ env, io, deps: { resolveBinary: () => "" } });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /build-opencode-vi/);
});

test("tui: mở binary với OPENCODE_CONFIG/TUI_CONFIG + chuyển tiếp tham số + mã thoát", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = managedConfigFile(env, "opencode");
  const tuiConfigPath = managedTuiConfigFile(env, "opencode");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, "{}");
  writeFileSync(tuiConfigPath, "{}");

  const calls = [];
  const child = {
    once(event, cb) {
      if (event === "close") setImmediate(() => cb(7));
      return this;
    },
  };
  const { io, lines } = makeIo();
  const code = await cmdTui({
    flags: { _: ["run", "xin chào"] },
    env,
    io,
    deps: {
      resolveBinary: () => "C:/gia/opencode.exe",
      spawn: (bin, args, opts) => {
        calls.push({ bin, args, opts });
        return child;
      },
    },
  });
  assert.equal(code, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, "C:/gia/opencode.exe");
  assert.deepEqual(calls[0].args, ["run", "xin chào"]);
  assert.equal(calls[0].opts.env.OPENCODE_CONFIG, configPath);
  assert.equal(calls[0].opts.env.OPENCODE_TUI_CONFIG, tuiConfigPath);
  assert.equal(calls[0].opts.stdio, "inherit");
  assert.match(lines.join("\n"), /Mở TUI|Launching the Vietnamese/);
});

test("tuiBinaryCandidates: ưu tiên --bin > env > package", () => {
  const candidates = tuiBinaryCandidates({
    flags: { bin: "B:/bin.exe" },
    env: { CRIZON_OPENCODE_VI_BIN: "C:/env.exe", CRIZON_HOME: "D:/home" },
    packageDir: "E:/pkg",
    repoRoot: "F:/repo",
  });
  assert.equal(candidates[0], "B:/bin.exe");
  assert.equal(candidates[1], "C:/env.exe");
  assert.ok(candidates.some((path) => path.startsWith("E:") && path.includes("dist")));
  assert.ok(candidates.some((path) => path.startsWith("F:") && path.includes("reference")));
});

test("resolveTuiBinary: không có ứng viên nào → ''", () => {
  const missing = join(tmpdir(), "crizon-khong-ton-tai-9f2a");
  assert.equal(resolveTuiBinary({ flags: {}, env: { CRIZON_HOME: missing }, packageDir: missing, repoRoot: missing }), "");
});

test("tuiDownloadUrl: windows-x64 có asset, nền tảng khác chưa hỗ trợ", () => {
  assert.equal(
    tuiDownloadUrl({ env: {}, platform: "win32", arch: "x64" }),
    "https://github.com/Catdzx13/crizon-ai/releases/latest/download/opencode-windows-x64.exe",
  );
  assert.equal(
    tuiDownloadUrl({ env: { CRIZON_TUI_DOWNLOAD_BASE: "https://x.test/dl/" }, platform: "win32", arch: "x64" }),
    "https://x.test/dl/opencode-windows-x64.exe",
  );
  assert.equal(tuiDownloadUrl({ env: {}, platform: "darwin", arch: "arm64" }), "");
});

test("downloadTuiBinary: tải + ghi file, lỗi rõ ràng", async (t) => {
  const { dir } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dest = join(dir, "bin", "opencode.exe");
  const bytes = new Uint8Array([77, 90, 1, 2, 3]); // "MZ…"
  const size = await downloadTuiBinary({
    url: "https://x.test/opencode.exe",
    dest,
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  });
  assert.equal(size, bytes.length);
  assert.deepEqual([...readFileSync(dest)], [...bytes]);

  await assert.rejects(() => downloadTuiBinary({ url: "", dest }), /chưa có bản TUI/);
  await assert.rejects(
    () => downloadTuiBinary({ url: "https://x.test/missing", dest, fetchImpl: async () => new Response("no", { status: 404 }) }),
    /HTTP 404/,
  );
});

test("tui: không có binary → tự tải từ GitHub Releases rồi chạy", { skip: process.platform !== "win32" }, async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = managedConfigFile(env, "opencode");
  const tuiConfigPath = managedTuiConfigFile(env, "opencode");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, "{}");
  writeFileSync(tuiConfigPath, "{}");

  const downloads = [];
  const spawned = [];
  const child = {
    once(event, cb) {
      if (event === "close") setImmediate(() => cb(0));
      return this;
    },
  };
  const { io, lines } = makeIo();
  const code = await cmdTui({
    env: { ...env, CRIZON_TUI_DOWNLOAD_BASE: "https://x.test/dl" },
    io,
    deps: {
      resolveBinary: () => "",
      download: async ({ url, dest }) => {
        downloads.push({ url, dest });
        return 42 * 1024 * 1024;
      },
      spawn: (bin) => {
        spawned.push(bin);
        return child;
      },
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(downloads, [
    { url: "https://x.test/dl/opencode-windows-x64.exe", dest: join(env.CRIZON_HOME, "bin", "opencode.exe") },
  ]);
  assert.equal(spawned.length, 1);
  assert.match(lines.join("\n"), /Đã tải TUI|downloaded/);
});

test("tui: --no-download thì không tải, báo thiếu binary (exit 2)", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = managedConfigFile(env, "opencode");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, "{}");

  let downloads = 0;
  const { io, lines } = makeIo();
  const code = await cmdTui({
    flags: { "no-download": true },
    env,
    io,
    deps: {
      resolveBinary: () => "",
      download: async () => {
        downloads += 1;
        return 0;
      },
    },
  });
  assert.equal(code, 2);
  assert.equal(downloads, 0);
  assert.match(lines.join("\n"), /Chưa có TUI|not found/);
});
