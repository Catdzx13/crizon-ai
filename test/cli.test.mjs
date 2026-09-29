import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ApiError, CrizonClient } from "../src/client.mjs";
import { cmdAsk, cmdConfig, cmdEnv, cmdLogin, cmdModels } from "../src/commands.mjs";
import { maskKey, parseArgs } from "../src/util.mjs";

function makeIo() {
  const lines = [];
  const writes = [];
  const errs = [];
  return {
    io: {
      out: (line = "") => lines.push(String(line)),
      write: (text) => writes.push(String(text)),
      err: (line = "") => errs.push(String(line)),
    },
    lines,
    writes,
    errs,
  };
}

function startFixture() {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const unauthorized = () => send(401, { error: { code: "invalid_api_key", message: "Unauthorized", retryable: false } });
    if (req.url === "/v1/models") {
      if (auth !== "Bearer testkey") return unauthorized();
      return send(200, { object: "list", data: [{ id: "crizon/gpt-standard", object: "model", owned_by: "crizon" }] });
    }
    if (req.url === "/v1/chat/completions") {
      if (auth !== "Bearer testkey") return unauthorized();
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"Xin"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":" chào"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        send(200, {
          id: "chatcmpl-test",
          choices: [{ message: { role: "assistant", content: "Xin chào" } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        });
      });
      return;
    }
    send(404, { error: { code: "not_found", retryable: false } });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` });
    });
  });
}

function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-"));
  const env = { ...process.env, CRIZON_CONFIG_PATH: join(dir, "config.json") };
  delete env.CRIZON_API_KEY;
  delete env.CRIZON_BASE_URL;
  delete env.CRIZON_MODEL;
  return env;
}

test("parseArgs: flag=value, flag value, --no-*, positionals", () => {
  const { flags, positionals } = parseArgs(["ask", "hello", "world", "--model=gpt", "--system", "sys", "--no-stream"]);
  assert.deepEqual(positionals, ["ask", "hello", "world"]);
  assert.equal(flags.model, "gpt");
  assert.equal(flags.system, "sys");
  assert.equal(flags["no-stream"], true);
});

test("parseArgs: báo lỗi khi thiếu giá trị", () => {
  const parsed = parseArgs(["ask", "--model"]);
  assert.ok(parsed.error);
});

test("maskKey: ẩn phần giữa", () => {
  assert.equal(maskKey(""), "(chưa có)");
  assert.match(maskKey("czn_1234567890abcdef"), /^czn_1234…cdef$/);
});

test("client.models: gọi đúng path + auth", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.server.close());
  const client = new CrizonClient({ baseUrl: fixture.baseUrl, apiKey: "testkey" });
  const data = await client.models();
  assert.equal(data.data[0].id, "crizon/gpt-standard");
});

test("client: lỗi 401 → ApiError đúng envelope", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.server.close());
  const client = new CrizonClient({ baseUrl: fixture.baseUrl, apiKey: "sai" });
  await assert.rejects(
    () => client.models(),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.code, "invalid_api_key");
      return true;
    },
  );
});

test("client.chatStream: gom delta + usage", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.server.close());
  const client = new CrizonClient({ baseUrl: fixture.baseUrl, apiKey: "testkey" });
  const deltas = [];
  const result = await client.chatStream(
    { model: "crizon/gpt-standard", messages: [{ role: "user", content: "hi" }] },
    (delta) => deltas.push(delta),
  );
  assert.equal(result.content, "Xin chào");
  assert.deepEqual(deltas, ["Xin", " chào"]);
  assert.equal(result.usage.completion_tokens, 2);
});

test("cmdModels: in danh sách model", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.server.close());
  const { io, lines } = makeIo();
  const code = await cmdModels({ flags: { key: "testkey", "base-url": fixture.baseUrl }, env: tempEnv(), io });
  assert.equal(code, 0);
  assert.ok(lines.some((line) => line.includes("crizon/gpt-standard")));
});

test("cmdModels: thiếu key → exit 2 + hướng dẫn", async () => {
  const { io, lines } = makeIo();
  const code = await cmdModels({ flags: {}, env: tempEnv(), io });
  assert.equal(code, 2);
  assert.ok(lines.join("\n").includes("Chưa có API key"));
});

test("cmdAsk: stream ra io.write và exit 0", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.server.close());
  const { io, writes } = makeIo();
  const code = await cmdAsk({
    flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["Xin", "chào"] },
    env: tempEnv(),
    io,
  });
  assert.equal(code, 0);
  assert.equal(writes.join(""), "Xin chào");
});

test("cmdAsk --no-stream: in một lần", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.server.close());
  const { io, lines } = makeIo();
  const code = await cmdAsk({
    flags: { key: "testkey", "base-url": fixture.baseUrl, "no-stream": true, _: ["hi"] },
    env: tempEnv(),
    io,
  });
  assert.equal(code, 0);
  assert.ok(lines.includes("Xin chào"));
});

test("cmdLogin + cmdConfig: lưu key (600) rồi che khi hiển thị", async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.server.close());
  const env = tempEnv();
  const login = makeIo();
  const code = await cmdLogin({ flags: { key: "testkey", "base-url": fixture.baseUrl }, env, io: login.io });
  assert.equal(code, 0);
  assert.ok(login.lines.join("\n").includes("Đã lưu API key"));
  const config = makeIo();
  const code2 = await cmdConfig({ flags: { check: true }, env, io: config.io });
  assert.equal(code2, 0);
  const text = config.lines.join("\n");
  assert.ok(text.includes("Kết nối OK"));
  assert.ok(!text.includes("testkey"), "không được in raw key");
});

test("cmdEnv: in biến môi trường powershell/bash", async () => {
  const env = { ...tempEnv(), CRIZON_API_KEY: "czn_demo", CRIZON_BASE_URL: "https://example.test/v1" };
  const ps = makeIo();
  await cmdEnv({ flags: { shell: "powershell" }, env, io: ps.io });
  assert.ok(ps.lines.join("\n").includes('$env:OPENAI_BASE_URL = "https://example.test/v1"'));
  const bash = makeIo();
  await cmdEnv({ flags: {}, env, io: bash.io });
  assert.ok(bash.lines.join("\n").includes('export OPENAI_API_KEY="czn_demo"'));
});
