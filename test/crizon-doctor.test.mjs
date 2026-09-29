import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { doctorScriptSource } from "../src/harness.mjs";

function makeProject(t) {
  const dir = mkdtempSync(join(tmpdir(), "crizon-doctor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "crizon-doctor.mjs");
  writeFileSync(script, doctorScriptSource());
  return { dir, script };
}

/** Chạy script bằng spawn (async) — execFileSync sẽ chặn event loop làm server trong test không trả lời được. */
function run(script, dir, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: dir, env: { ...process.env, ...extraEnv } });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", () => resolve(out));
  });
}

function writeConfig(dir, baseURL) {
  const configPath = join(dir, "tui.json");
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      crizon: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL, apiKey: "czn_test_key_123456" },
        models: { "gpt-standard": { name: "gpt-standard" } },
      },
    },
    model: "crizon/gpt-standard",
    share: "disabled",
    command: { goal: { template: "x" }, crizon: { template: "y" } },
    agent: { "goal-runner": { prompt: "x" } },
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

test("crizon-doctor: ✓ khi gateway /models trả OK + có goal state", async (t) => {
  const { dir, script } = makeProject(t);
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-standard" }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const configPath = writeConfig(dir, `http://127.0.0.1:${port}/v1`);

  mkdirSync(join(dir, ".crizon"), { recursive: true });
  writeFileSync(
    join(dir, ".crizon", "goal.json"),
    `${JSON.stringify({ version: 1, objective: "hoàn tất GĐ1", status: "active" }, null, 2)}\n`,
  );

  const out = await run(script, dir, ["--config", configPath]);
  assert.match(out, /Chẩn đoán Crizon/);
  assert.match(out, /✓ Config/);
  assert.match(out, /✓ Provider crizon/);
  assert.match(out, /✓ API key/);
  assert.match(out, /✓ Gateway \/models — 200 · 1 model/);
  assert.match(out, /✓ Lệnh \/goal/);
  assert.match(out, /• Goal hiện tại — hoàn tất GĐ1/, "hiển thị goal hiện tại");
});

test("crizon-doctor: ✗ khi gateway không kết nối được + thiếu config", async (t) => {
  const { dir, script } = makeProject(t);
  const configPath = writeConfig(dir, "http://127.0.0.1:9/v1"); // cổng đóng
  const out = await run(script, dir, ["--config", configPath]);
  assert.match(out, /✗ Gateway/);
  assert.match(out, /• Goal — chưa có mục tiêu/);

  const missing = await run(script, dir, ["--config", join(dir, "khong-ton-tai.json")]);
  assert.match(missing, /✗ Config/);
});

test("crizon-doctor: --page ghi trang HTML trạng thái local", async (t) => {
  const { dir, script } = makeProject(t);
  const configPath = writeConfig(dir, "http://127.0.0.1:9/v1");
  const page = join(dir, "status.html");

  const out = await run(script, dir, ["--config", configPath, "--page", "--page-path", page]);
  assert.ok(existsSync(page), "phải ghi trang HTML");
  const html = readFileSync(page, "utf8");
  assert.match(html, /CRIZON AI — Trạng thái kết nối/);
  assert.match(html, /✗ Gateway/);
  assert.match(out, /• Trang trạng thái/);
});

test("crizon-doctor: --open tôn trọng CRIZON_NO_BROWSER (không mở trình duyệt khi test)", async (t) => {
  const { dir, script } = makeProject(t);
  const configPath = writeConfig(dir, "http://127.0.0.1:9/v1");
  const page = join(dir, "status-open.html");

  const out = await run(script, dir, ["--config", configPath, "--open", "--page-path", page], { CRIZON_NO_BROWSER: "1" });
  assert.match(out, /chưa mở/, "phải ghi rõ chưa mở trình duyệt");
  assert.ok(existsSync(page), "vẫn ghi trang");
});
