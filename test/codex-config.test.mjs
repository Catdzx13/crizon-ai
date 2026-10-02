import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cmdDisconnect, cmdLogin, cmdSetup } from "../src/commands.mjs";
import {
  CODEX_DISABLED,
  CodexConfigConflict,
  applyCodexConfig,
  codexConfigPath,
  hasCodexConfig,
  removeCodexConfig,
} from "../src/codex-config.mjs";

function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-codex-"));
  const env = {
    ...process.env,
    CRIZON_CONFIG_PATH: join(dir, "config.json"),
    CRIZON_HOME: join(dir, "home"),
    CRIZON_PROFILE_PATH: join(dir, "profile.ps1"),
    CODEX_HOME: join(dir, "codex"),
  };
  delete env.CRIZON_API_KEY;
  delete env.CRIZON_BASE_URL;
  delete env.CRIZON_MODEL;
  delete env.CRIZON_LANG;
  return { env, dir };
}

function makeIo() {
  const lines = [];
  return { io: { out: (line = "") => lines.push(String(line)), write: () => {}, err: () => {} }, lines };
}

function gatewayFixture() {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/v1/models") {
      if (!["Bearer testkey", "Bearer newkey"].includes(auth)) return send(401, { error: { code: "invalid_api_key" } });
      return send(200, { object: "list", data: [{ id: "claude-sonnet-4-6" }] });
    }
    if (req.method === "HEAD") return res.writeHead(204).end();
    send(404, { error: { code: "not_found" } });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })));
}

const cfg = { baseUrl: "https://ai.example.test/v1", apiKey: "czn_secret" };

test("codex-config: file trống → provider crizon + mặc định, không backup", () => {
  const { env } = tempEnv();
  const result = applyCodexConfig(cfg, { env, model: "claude-sonnet-4-6" });
  assert.equal(result.backup, null);
  const text = readFileSync(codexConfigPath(env), "utf8");
  assert.match(text, /^# >>> crizon-ai \(codex\) >>>\nmodel_provider = "crizon"\nmodel = "claude-sonnet-4-6"/);
  assert.match(text, /\[model_providers\.crizon\]\nname = "Crizon AI"\nbase_url = "https:\/\/ai\.example\.test\/v1"\nexperimental_bearer_token = "czn_secret"\nwire_api = "responses"/);
  assert.equal(hasCodexConfig(env), true);
});

test("codex-config: giữ cấu hình người dùng, tạm tắt model/profile gốc, gỡ thì khôi phục nguyên trạng", () => {
  const { env } = tempEnv();
  const path = codexConfigPath(env);
  mkdirSync(join(env.CODEX_HOME), { recursive: true });
  const original = [
    "# my codex config",
    'model = "gpt-5"',
    'profile = "work"',
    'approval_policy = "on-request"',
    "",
    "[profiles.work]",
    'model = "o3"',
    "",
    "[mcp_servers.docs]",
    'command = "npx"',
    "",
  ].join("\n");
  writeFileSync(path, original);

  const first = applyCodexConfig(cfg, { env, model: "claude-sonnet-4-6" });
  assert.ok(first.backup && existsSync(first.backup));
  const applied = readFileSync(path, "utf8");
  assert.ok(applied.startsWith("# >>> crizon-ai (codex) >>>"));
  assert.ok(applied.includes(`${CODEX_DISABLED}model = "gpt-5"`));
  assert.ok(applied.includes(`${CODEX_DISABLED}profile = "work"`));
  assert.ok(applied.includes('approval_policy = "on-request"'));
  // model trong bảng [profiles.work] không phải khoá gốc → giữ nguyên.
  assert.ok(applied.includes('[profiles.work]\nmodel = "o3"'));
  assert.ok(applied.trimEnd().endsWith("# <<< crizon-ai <<<"));

  // Ghi lại (đổi key) không nhân đôi khối, không tắt chồng hai lần.
  applyCodexConfig({ ...cfg, apiKey: "czn_new" }, { env, model: "claude-sonnet-4-6" });
  const reapplied = readFileSync(path, "utf8");
  assert.equal(reapplied.split("[model_providers.crizon]").length - 1, 1);
  assert.equal(reapplied.split(CODEX_DISABLED).length - 1, 2);
  assert.ok(reapplied.includes("czn_new") && !reapplied.includes("czn_secret"));

  const removed = removeCodexConfig({ env });
  assert.equal(removed.removed, true);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.equal(hasCodexConfig(env), false);
});

test("codex-config: bảng [model_providers.crizon] tự viết → báo xung đột, không sửa file", () => {
  const { env } = tempEnv();
  const path = codexConfigPath(env);
  mkdirSync(env.CODEX_HOME, { recursive: true });
  const original = '[model_providers.crizon]\nbase_url = "https://other"\n';
  writeFileSync(path, original);
  assert.throws(() => applyCodexConfig(cfg, { env }), CodexConfigConflict);
  assert.equal(readFileSync(path, "utf8"), original);
});

test("codex-config: giữ CRLF của file Windows", () => {
  const { env } = tempEnv();
  mkdirSync(env.CODEX_HOME, { recursive: true });
  writeFileSync(codexConfigPath(env), 'model = "gpt-5"\r\n[tui]\r\nnotifications = true\r\n');
  applyCodexConfig(cfg, { env });
  const text = readFileSync(codexConfigPath(env), "utf8");
  assert.ok(!/[^\r]\n/.test(text), "mọi dòng phải là CRLF");
});

test("cmdSetup codex: ghi config.toml (model lấy từ gateway), không ghi profile, gỡ được", async (t) => {
  const fixture = await gatewayFixture();
  t.after(() => fixture.server.close());
  const { env } = tempEnv();
  const { io, lines } = makeIo();
  const code = await cmdSetup({ flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["codex"], yes: true }, env, io });
  assert.equal(code, 0);
  assert.ok(!lines.join("\n").includes("testkey"), "stdout không được chứa raw key");
  const text = readFileSync(codexConfigPath(env), "utf8");
  assert.match(text, /model = "claude-sonnet-4-6"/);
  assert.match(text, /experimental_bearer_token = "testkey"/);
  assert.ok(!existsSync(String(env.CRIZON_PROFILE_PATH)), "Codex không cần biến môi trường trong profile");
  const saved = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  assert.equal(saved.harnessConfigs.codex.applied, true);

  const off = await cmdDisconnect({ flags: { _: ["codex"] }, env, io: makeIo().io });
  assert.equal(off, 0);
  assert.equal(hasCodexConfig(env), false);
});

test("login --key: key mới được ghi lại vào mọi app đã kết nối (Claude profile + Codex config)", async (t) => {
  const fixture = await gatewayFixture();
  t.after(() => fixture.server.close());
  const { env } = tempEnv();
  await cmdSetup({ flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["codex"], yes: true }, env, io: makeIo().io });
  await cmdSetup({ flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["claude"], yes: true }, env, io: makeIo().io });
  // Lưu base-url vào file để login dùng lại.
  const file = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  writeFileSync(String(env.CRIZON_CONFIG_PATH), JSON.stringify({ ...file, baseUrl: fixture.baseUrl, apiKey: "testkey" }));

  const { io, lines } = makeIo();
  const code = await cmdLogin({ flags: { key: "newkey" }, env, io });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /Codex/);
  assert.match(lines.join("\n"), /Claude Code/);
  assert.match(readFileSync(codexConfigPath(env), "utf8"), /experimental_bearer_token = "newkey"/);
  const profile = readFileSync(String(env.CRIZON_PROFILE_PATH), "utf8");
  assert.match(profile, /ANTHROPIC_AUTH_TOKEN = "newkey"/);
  assert.ok(!profile.includes("testkey"));
});
