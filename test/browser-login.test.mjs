import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  authorizeUrl,
  createLoginSession,
  pkcePair,
  readCallback,
  runBrowserLogin,
} from "../src/browser-login.mjs";

function tempEnv(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-login-"));
  const env = { ...process.env, CRIZON_CONFIG_PATH: join(dir, "config.json"), CRIZON_HOME: join(dir, "home"), CRIZON_NO_BROWSER: "1", ...extra };
  delete env.CRIZON_API_KEY;
  return env;
}

const makeIo = () => {
  const lines = [];
  return { io: { out: (line = "") => lines.push(String(line)) }, lines };
};

/** Backend giả: nhận đúng code + verifier khớp challenge thì trả key. */
function exchangeFixture(expected) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ url: req.url, body });
      const challenge = createHash("sha256").update(String(body.codeVerifier || "")).digest("base64url");
      const ok = req.url === "/api/ai/cli-auth/exchange" && body.code === expected.code && challenge === expected.challenge();
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { key: "czn_from_browser", label: "Laptop · Crizon CLI", lastFour: "wser" } : { message: "invalid_code" }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, origin: `http://127.0.0.1:${server.address().port}` })));
}

test("pkce: challenge = base64url(sha256(verifier)), verifier đủ dài", () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
});

test("authorizeUrl: đủ tham số, redirect loopback, không chứa verifier", () => {
  const session = createLoginSession("http://127.0.0.1:4731/callback");
  const url = new URL(authorizeUrl("https://shop.test/dashboard/", session, "Laptop"));
  assert.equal(url.origin + url.pathname, "https://shop.test/dashboard/authorize");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:4731/callback");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), session.challenge);
  assert.equal(url.searchParams.get("device"), "Laptop");
  assert.ok(!url.toString().includes(session.verifier));
});

test("readCallback: sai state / hết hạn / từ chối / thiếu mã đều bị chặn", () => {
  const session = createLoginSession("http://127.0.0.1:1/callback");
  const at = (query) => new URL(`http://127.0.0.1:1/callback?${query}`);
  assert.deepEqual(readCallback(at(`state=${session.state}&code=${"a".repeat(32)}`), session), { ok: true, code: "a".repeat(32) });
  assert.equal(readCallback(at(`state=wrong&code=${"a".repeat(32)}`), session).reason, "state");
  assert.equal(readCallback(at(`state=${session.state}&error=access_denied`), session).reason, "denied");
  assert.equal(readCallback(at(`state=${session.state}&code=bad!`), session).reason, "code");
  assert.equal(readCallback(at(`state=${session.state}&code=${"a".repeat(32)}`), { ...session, createdAt: 0 }).reason, "expired");
});

test("runBrowserLogin: mở trang đồng ý → callback → đổi mã → lưu key", async (t) => {
  const expected = { code: "c".repeat(40), challenge: () => "" };
  const fixture = await exchangeFixture(expected);
  t.after(() => fixture.server.close());
  const env = tempEnv({ CRIZON_API_ORIGIN: fixture.origin, CRIZON_PORTAL_URL: "https://shop.test/dashboard" });
  const { io, lines } = makeIo();
  const open = (url) => {
    const target = new URL(url);
    expected.challenge = () => target.searchParams.get("code_challenge");
    const redirect = new URL(target.searchParams.get("redirect_uri"));
    redirect.searchParams.set("code", expected.code);
    redirect.searchParams.set("state", target.searchParams.get("state"));
    // Giả lập trình duyệt quay về sau khi khách bấm Cho phép.
    setTimeout(() => fetch(redirect).then((res) => res.text()), 20);
    return true;
  };
  const saved = await runBrowserLogin({ env, io, open, port: 0, timeoutMs: 5_000 });
  assert.deepEqual(saved, { label: "Laptop · Crizon CLI", lastFour: "wser" });
  assert.equal(JSON.parse(readFileSync(env.CRIZON_CONFIG_PATH, "utf8")).apiKey, "czn_from_browser");
  assert.equal(fixture.calls.length, 1);
  assert.ok(!lines.join("\n").includes("czn_from_browser"), "không in key ra màn hình");
});

test("runBrowserLogin: state giả mạo → không đổi mã, không lưu key", async (t) => {
  const expected = { code: "c".repeat(40), challenge: () => "" };
  const fixture = await exchangeFixture(expected);
  t.after(() => fixture.server.close());
  const env = tempEnv({ CRIZON_API_ORIGIN: fixture.origin });
  const open = (url) => {
    const redirect = new URL(new URL(url).searchParams.get("redirect_uri"));
    redirect.searchParams.set("code", expected.code);
    redirect.searchParams.set("state", "forged-state");
    setTimeout(() => fetch(redirect).then((res) => res.text()), 20);
    return true;
  };
  const saved = await runBrowserLogin({ env, io: makeIo().io, open, port: 0, timeoutMs: 5_000 });
  assert.equal(saved, null);
  assert.equal(fixture.calls.length, 0);
});
