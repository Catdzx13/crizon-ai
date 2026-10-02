import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codexConfigPath, hasCodexConfig } from "../src/codex-config.mjs";
import { startUiServer } from "../src/ui-server.mjs";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

/** Gateway giả: chấp nhận testkey/newkey, HEAD = 204. */
async function gateway() {
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      const ok = ["Bearer testkey", "Bearer newkey"].includes(req.headers.authorization);
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { data: [{ id: "claude-sonnet-4-6" }] } : { error: { code: "invalid_api_key" } }));
      return;
    }
    res.writeHead(req.method === "HEAD" ? 204 : 404).end();
  });
  return { server, baseUrl: `http://127.0.0.1:${await listen(server)}/v1` };
}

/** Backend giả cho bước đổi mã lấy key (kiểm PKCE). */
async function exchanger(state) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const challenge = createHash("sha256").update(String(body.codeVerifier || "")).digest("base64url");
      const ok = body.code === state.code && challenge === state.challenge;
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { key: "newkey", label: "Laptop · Crizon CLI", lastFour: "wkey" } : { message: "invalid_code" }));
    });
  });
  return { server, origin: `http://127.0.0.1:${await listen(server)}` };
}

function call(port, method, path, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        host: `127.0.0.1:${port}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* HTML */ }
        resolve({ status: res.statusCode, headers: res.headers, text: raw, json });
      });
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function setup(t, extraEnv = {}) {
  const gw = await gateway();
  t.after(() => gw.server.close());
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-ui-"));
  const env = {
    ...process.env,
    CRIZON_CONFIG_PATH: join(dir, "config.json"),
    CRIZON_HOME: join(dir, "home"),
    CRIZON_PROFILE_PATH: join(dir, "profile.ps1"),
    CODEX_HOME: join(dir, "codex"),
    CRIZON_BASE_URL: gw.baseUrl,
    CRIZON_PORTAL_URL: "https://shop.test/dashboard",
    ...extraEnv,
  };
  delete env.CRIZON_API_KEY;
  delete env.CRIZON_LANG;
  const ui = await startUiServer({ env, port: 0 });
  t.after(() => ui.close());
  return { env, ui, port: ui.port, token: ui.token };
}

test("ui: trang tĩnh có CSP chặt, token nằm trong #fragment", async (t) => {
  const { ui, port } = await setup(t);
  assert.match(ui.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/#t=[A-Za-z0-9_-]{30,}$`));
  const page = await call(port, "GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /script-src 'self'/);
  assert.ok(!page.headers["content-security-policy"].includes("unsafe-inline"));
  // Ảnh kho chỉ từ host GitHub, không mở toàn bộ https:.
  assert.match(page.headers["content-security-policy"], /img-src 'self' data: https:\/\/avatars\.githubusercontent\.com /);
  assert.ok(!/img-src[^;]*https: /.test(page.headers["content-security-policy"]));
  assert.match(page.text, /<script src="\/app\.js" defer>/);
  const brands = await call(port, "GET", "/brands.js");
  assert.equal(brands.status, 200);
  assert.match(brands.text, /window\.CRIZON_BRANDS = .*"openai"/);
  const aider = await call(port, "GET", "/aider.png");
  assert.equal(aider.status, 200);
  assert.equal(aider.headers["content-type"], "image/png");
});

test("ui: chặn thiếu token, Host lạ (DNS rebinding), Origin lạ, body không phải JSON", async (t) => {
  const { port, token } = await setup(t);
  assert.equal((await call(port, "GET", "/api/state")).status, 401);
  assert.equal((await call(port, "GET", "/api/state", { token: "x".repeat(32) })).status, 401);
  assert.equal((await call(port, "GET", "/api/state", { token, headers: { host: `evil.test:${port}` } })).status, 403);
  assert.equal((await call(port, "GET", "/", { headers: { host: "evil.test" } })).status, 403);
  assert.equal((await call(port, "POST", "/api/key", { token, body: { key: "testkey" }, headers: { origin: "http://evil.test" } })).status, 403);
  assert.equal((await call(port, "POST", "/api/key", { token, body: "key=testkey", headers: { "content-type": "text/plain" } })).status, 415);
  const ok = await call(port, "GET", "/api/state", { token, headers: { origin: `http://127.0.0.1:${port}` } });
  assert.equal(ok.status, 200);
});

test("ui: gắn key → bật Codex → thay key (tự cập nhật Codex) → key sai không lưu → tắt Codex", async (t) => {
  const { env, port, token } = await setup(t);
  const saved = await call(port, "POST", "/api/key", { token, body: { key: "testkey" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.verified, true);
  assert.equal(saved.json.state.account.hasKey, true);
  assert.ok(!saved.text.includes("testkey"), "API không bao giờ trả key thô");

  const on = await call(port, "POST", "/api/apps/codex/connect", { token, body: {} });
  assert.equal(on.status, 200);
  assert.equal(on.json.state.apps.find((app) => app.id === "codex").connected, true);
  assert.match(readFileSync(codexConfigPath(env), "utf8"), /experimental_bearer_token = "testkey"/);

  const replaced = await call(port, "POST", "/api/key", { token, body: { key: "newkey" } });
  assert.deepEqual(replaced.json.reapplied, [{ id: "codex", ok: true }]);
  assert.match(readFileSync(codexConfigPath(env), "utf8"), /experimental_bearer_token = "newkey"/);

  const bad = await call(port, "POST", "/api/key", { token, body: { key: "badkey" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "invalid_key");
  assert.equal(JSON.parse(readFileSync(env.CRIZON_CONFIG_PATH, "utf8")).apiKey, "newkey");

  const off = await call(port, "POST", "/api/apps/codex/disconnect", { token, body: {} });
  assert.equal(off.status, 200);
  assert.equal(hasCodexConfig(env), false);
});

test("ui: kiểm tra kết nối + đổi model mặc định", async (t) => {
  const { port, token } = await setup(t);
  await call(port, "POST", "/api/key", { token, body: { key: "testkey" } });
  const checked = await call(port, "POST", "/api/check", { token, body: {} });
  assert.equal(checked.json.gateway.ok, true);
  assert.equal(checked.json.gateway.count, 1);
  assert.equal(checked.json.apps.codex.path, "/v1/responses");
  assert.equal(checked.json.apps.claude.supported, true);
  const models = await call(port, "GET", "/api/models", { token });
  assert.deepEqual(models.json.models, ["claude-sonnet-4-6"]);
  const model = await call(port, "POST", "/api/model", { token, body: { model: "claude-sonnet-4-6" } });
  assert.equal(model.json.state.account.model, "claude-sonnet-4-6");
});

test("ui: đăng nhập trình duyệt — state giả bị chặn, đúng state + PKCE thì lưu key", async (t) => {
  const pkce = { code: "c".repeat(40), challenge: "" };
  const backend = await exchanger(pkce);
  t.after(() => backend.server.close());
  const { env, port, token } = await setup(t, { CRIZON_API_ORIGIN: backend.origin });

  const first = await call(port, "POST", "/api/login", { token, body: {} });
  const authorize = new URL(first.json.url);
  assert.equal(authorize.origin + authorize.pathname, "https://shop.test/dashboard/authorize");
  assert.equal(authorize.searchParams.get("redirect_uri"), `http://127.0.0.1:${port}/callback`);
  const forged = await call(port, "GET", `/callback?state=forged&code=${pkce.code}`);
  assert.match(forged.text, /Chưa kết nối được|Not connected/);
  assert.equal((await call(port, "GET", "/api/state", { token })).json.login.last.reason, "state");

  const second = await call(port, "POST", "/api/login", { token, body: {} });
  const url = new URL(second.json.url);
  pkce.challenge = url.searchParams.get("code_challenge");
  const done = await call(port, "GET", `/callback?state=${url.searchParams.get("state")}&code=${pkce.code}`);
  assert.match(done.headers["content-security-policy"], /default-src 'none'/);
  assert.match(done.text, /Laptop · Crizon CLI/);
  assert.equal(JSON.parse(readFileSync(env.CRIZON_CONFIG_PATH, "utf8")).apiKey, "newkey");
  const after = (await call(port, "GET", "/api/state", { token })).json;
  assert.equal(after.login.pending, false);
  assert.equal(after.login.last.ok, true);
});

test("ui: nút Đóng tắt server", async (t) => {
  const { ui, port, token } = await setup(t);
  assert.equal((await call(port, "POST", "/api/quit", { token, body: {} })).status, 200);
  await ui.closed;
});

test("ui: MCP + skill — liệt kê không lộ bí mật, bật cho Codex, lỗi trả mã rõ ràng", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-ui-mcp-"));
  const home = join(dir, "user");
  mkdirSync(join(home, ".claude", "skills", "pdf"), { recursive: true });
  writeFileSync(join(home, ".claude", "skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: PDF tools\n---\n");
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "gh-mcp@1.0.0"], env: { TOKEN: "s3cret-value" } } } }));
  const { port, token, env } = await setup(t, { CRIZON_USER_HOME: home, CODEX_HOME: join(home, ".codex") });
  delete env.CLAUDE_CONFIG_DIR;
  mkdirSync(join(home, ".codex"));

  const list = await call(port, "GET", "/api/mcp", { token });
  assert.equal(list.status, 200);
  assert.ok(!list.text.includes("s3cret-value"));
  assert.deepEqual(list.json.servers[0].summary.envKeys, ["TOKEN"]);

  const toggled = await call(port, "POST", "/api/mcp/toggle", { token, body: { name: "github", app: "codex", on: true } });
  assert.equal(toggled.json.servers[0].apps.codex, "on");
  assert.match(readFileSync(join(home, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.github\]/);

  const bad = await call(port, "POST", "/api/mcp", { token, body: { name: "github", def: { type: "stdio", command: "x" }, apps: ["claude"] } });
  assert.deepEqual([bad.status, bad.json.error], [409, "exists"]);

  const skills = await call(port, "GET", "/api/skills", { token });
  assert.deepEqual(skills.json.skills.map((skill) => [skill.dir, skill.apps.claude, skill.apps.codex]), [["pdf", "on", "absent"]]);
  const copied = await call(port, "POST", "/api/skills/toggle", { token, body: { dir: "pdf", app: "codex", on: true } });
  assert.equal(copied.json.skills[0].apps.codex, "on");
  const badUrl = await call(port, "POST", "/api/skills/preview", { token, body: { url: "https://evil.test/x" } });
  assert.deepEqual([badUrl.status, badUrl.json.error], [400, "invalid_url"]);
});

test("ui: bảng xếp hạng — lấy kho qua server cục bộ, cài MCP với giá trị nhập trên máy", async (t) => {
  const item = { id: "gh1", kind: "MCP", name: "gh-mcp", title: "GitHub", summary: "Quản lý GitHub", stars: 10, starsWeek: 0, verified: true, install: { type: "stdio", runtime: "npm", command: "npx", args: ["-y", "gh-mcp@1.0.0"], env: [{ name: "GH_TOKEN", required: true, secret: true }] } };
  const shop = createServer((req, res) => {
    res.writeHead(req.url.startsWith("/api/ai/hub") ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url.startsWith("/api/ai/hub?") ? { tab: "hot", items: [item] } : req.url === "/api/ai/hub/gh1" ? item : {}));
  });
  const shopPort = await listen(shop);
  t.after(() => shop.close());
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-ui-rank-"));
  const home = join(dir, "user");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const { port, token, env } = await setup(t, { CRIZON_USER_HOME: home, CODEX_HOME: join(home, ".codex"), CRIZON_API_ORIGIN: `http://127.0.0.1:${shopPort}` });
  delete env.CLAUDE_CONFIG_DIR;

  const list = await call(port, "GET", "/api/catalog?tab=hot&kind=mcp", { token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.items.map((row) => [row.id, row.installedIn]), [["gh1", []]]);

  const missing = await call(port, "POST", "/api/catalog/install", { token, body: { id: "gh1", values: {}, apps: ["claude"] } });
  assert.deepEqual([missing.status, missing.json.error, missing.json.detail], [400, "missing_value", "GH_TOKEN"]);
  const done = await call(port, "POST", "/api/catalog/install", { token, body: { id: "gh1", values: { GH_TOKEN: "ghp_local" }, apps: ["claude"] } });
  assert.equal(done.status, 200);
  assert.equal(JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).mcpServers["gh-mcp"].env.GH_TOKEN, "ghp_local");
  const after = await call(port, "GET", "/api/catalog?tab=hot", { token });
  assert.deepEqual(after.json.items[0].installedIn, ["claude"]);
  const detail = await call(port, "GET", "/api/catalog/item?id=gh1", { token });
  assert.deepEqual([detail.status, detail.json.title, detail.json.installedIn], [200, "GitHub", ["claude"]]);
});
