import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough, Writable } from "node:stream";
import test from "node:test";

import { cmdAsk, cmdLanguage, cmdLogin, cmdLogs, cmdRoles, loadRoles, rolesFile, saveRoles, settingsMenu } from "../src/commands.mjs";
import { resolveConfig } from "../src/config.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { detectLang, getLang, LANGS, setLang, t } from "../src/i18n.mjs";
import { appendLog, readLogs } from "../src/logs.mjs";
import { loadSession, saveSession } from "../src/sessions.mjs";
import { MarkdownStream, filterItems, inputHidden, paint, panel, renderMarkdown, select } from "../src/ui.mjs";
import { maskKey } from "../src/util.mjs";
import { runWizard } from "../src/wizard.mjs";

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

/** Fixture ghi nhớ body cuối cùng để assert (system prompt, model...). */
function startRecordingFixture() {
  const state = { lastBody: null, lastAuth: null };
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/v1/models") {
      if (auth !== "Bearer testkey") return send(401, { error: { code: "invalid_api_key", retryable: false } });
      return send(200, {
        object: "list",
        data: [
          { id: "crizon/gpt-standard", owned_by: "crizon" },
          { id: "crizon/deepseek-pro", owned_by: "crizon" },
        ],
      });
    }
    if (req.url === "/v1/chat/completions") {
      if (auth !== "Bearer testkey") return send(401, { error: { code: "invalid_api_key", retryable: false } });
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        state.lastBody = body;
        state.lastAuth = auth;
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"# Tiêu đề\\n\\nXin chào"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        send(200, {
          id: "chatcmpl-test",
          choices: [{ message: { role: "assistant", content: "# Tiêu đề\n\nXin chào" } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        });
      });
      return;
    }
    send(404, { error: { code: "not_found", retryable: false } });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1`, state });
    });
  });
}

function tempEnv(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-m2-"));
  const env = {
    ...process.env,
    CRIZON_CONFIG_PATH: join(dir, "config.json"),
    CRIZON_HOME: join(dir, "home"),
  };
  delete env.CRIZON_API_KEY;
  delete env.CRIZON_BASE_URL;
  delete env.CRIZON_MODEL;
  delete env.CRIZON_LANG;
  return { ...env, ...extra };
}

test("i18n: dịch theo ngôn ngữ + nội suy tham số + detectLang", () => {
  setLang("vi");
  assert.match(t("logs.title", { count: 3 }), /3/);
  setLang("en");
  assert.match(t("common.exit"), /Exit/);
  setLang("vi");
  assert.match(t("common.exit"), /Thoát/);
  assert.equal(detectLang({ LANG: "ko_KR.UTF-8" }), "vi", "locale hệ thống không tự đổi ngôn ngữ");
  assert.equal(detectLang({ LC_ALL: "en_US" }), "vi", "bỏ qua LC_ALL; chỉ dùng CRIZON_LANG");
  assert.equal(detectLang({ CRIZON_LANG: "en" }), "en");
  assert.equal(detectLang({}), "vi");
  assert.equal(getLang(), "vi");
  assert.deepEqual(LANGS.map((l) => l.code), ["vi", "en"]);
});

test("renderMarkdown: bỏ ký hiệu markdown + thêm ANSI khi bật màu", () => {
  const src = "# Tiêu đề\n\n**đậm** và `code`\n\n- mục một\n- mục hai\n";
  const plain = renderMarkdown(src, { color: false });
  assert.ok(plain.includes("Tiêu đề"));
  assert.ok(!plain.includes("**"));
  assert.ok(!plain.includes("# "));
  assert.ok(plain.includes("• mục một"));
  assert.ok(plain.includes("đậm"));
  const colored = renderMarkdown("**đậm**", { color: true });
  assert.ok(colored.includes("\u001b[1mđậm\u001b[0m"));
  assert.equal(paint(false, 1, "x"), "x");
  assert.equal(paint(true, 1, "x"), "\u001b[1mx\u001b[0m");
});

test("MarkdownStream: ghép chunk theo dòng, end() flush phần còn lại", () => {
  const out = [];
  const ms = new MarkdownStream({ color: false, write: (s) => out.push(s) });
  ms.feed("# Hel");
  ms.feed("lo\n\n**đậm**");
  assert.equal(out.join(""), "Hello\n\n");
  ms.end();
  assert.equal(out.join(""), "Hello\n\nđậm");
  // code fence giữ nguyên nội dung, bỏ hàng rào ```
  const fenced = renderMarkdown("```js\nconst a = 1;\n```\n", { color: false });
  assert.ok(fenced.includes("const a = 1;"));
  assert.ok(!fenced.includes("```"));
});

test("filterItems: lọc theo tiền tố/chuỗi con/nhiều từ", () => {
  const items = [{ id: "crizon/gpt-standard" }, { id: "crizon/deepseek-pro" }, { id: "anthropic/claude-sonnet" }];
  assert.equal(filterItems(items, "deep").length, 1);
  assert.equal(filterItems(items, "crizon").length, 2);
  assert.equal(filterItems(items, "").length, 3);
  assert.equal(filterItems(items, "không-tồn-tại").length, 0);
  assert.equal(filterItems(items.map((i) => ({ ...i, label: i.id })), "claude").length, 1);
});

test("select: fallback non-TTY đọc số từ stdin", async () => {
  const lines = [];
  const io = {
    out: (line = "") => lines.push(String(line)),
    write: () => {},
    err: () => {},
    stdin: Readable.from(["2\n"]),
    stdout: new Writable({ write(_c, _e, cb) { cb(); } }),
  };
  const picked = await select(io, [{ label: "một" }, { label: "hai" }, { label: "ba" }], { title: "Chọn" });
  assert.equal(picked.index, 1);
  assert.equal(picked.item.label, "hai");
});

function fakeTty() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 100;
  const chunks = [];
  output.on("data", (c) => chunks.push(String(c)));
  const io = { out: (line = "") => chunks.push(`${line}\n`), write() {}, err() {}, stdin: input, stdout: output };
  return { input, output, chunks, io };
}

test("select: nhánh TTY nhận mũi tên xuống + Enter (có khung panel)", async () => {
  const { input, io, chunks } = fakeTty();
  const pending = select(io, [{ label: "a" }, { label: "b" }, { label: "c" }], { title: "Chọn model" });
  await new Promise((r) => setTimeout(r, 20));
  input.write("\u001b[B\r");
  const picked = await pending;
  assert.equal(picked.index, 1);
  assert.equal(picked.item.label, "b");
  const drawn = chunks.join("");
  assert.ok(drawn.includes("┌─ Chọn model"), "menu phải vẽ khung");
  assert.ok(drawn.includes("│"), "menu phải có viền dọc");
  assert.ok(drawn.includes("❯"), "phải có con trỏ");
});

test("panel: TTY vẽ khung, non-TTY chỉ text", () => {
  const { io, chunks } = fakeTty();
  panel(io, "Tiêu đề", ["dòng 1", "❯ dòng 2"]);
  const drawn = chunks.join("");
  assert.ok(drawn.includes("┌─ Tiêu đề"));
  assert.ok(drawn.includes("└"));
  assert.ok(drawn.includes("dòng 1"));

  const plain = makeIo();
  panel(plain.io, "Tiêu đề", ["dòng 1"]);
  assert.deepEqual(plain.lines, ["Tiêu đề", "dòng 1"]);
});

test("inputHidden: nhánh TTY nhận key rồi Enter, hiện bullet", async () => {
  const { input, chunks, io } = fakeTty();
  const pending = inputHidden(io, { prompt: "Key: " });
  await new Promise((r) => setTimeout(r, 20));
  input.write("czn_secret\r");
  const value = await pending;
  assert.equal(value, "czn_secret");
  assert.ok(chunks.join("").includes("••••••••••"));
});

test("sessions: lưu/đọc/xoá với CRIZON_HOME tạm", () => {
  const env = tempEnv();
  const saved = saveSession(env, { name: "default", model: "crizon/gpt-standard", messages: [{ role: "user", content: "hi" }] });
  assert.ok(saved.endsWith(".json"));
  const loaded = loadSession(env, "default");
  assert.equal(loaded.model, "crizon/gpt-standard");
  assert.equal(loaded.messages.length, 1);
  assert.deepEqual(loadSession(env, "không-tồn-tại").messages, []);
});

test("logs: append → read → clear (JSONL)", () => {
  const env = tempEnv();
  appendLog(env, { kind: "ask", model: "m1", prompt: "p1", content: "c1", usage: { prompt_tokens: 1, completion_tokens: 2 } });
  appendLog(env, { kind: "chat", model: "m2", prompt: "p2", content: "c2" });
  const rows = readLogs(env, 10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, "m1");
  assert.equal(rows[1].kind, "chat");
});

test("cmdLogs: --json và --clear", async () => {
  const env = tempEnv();
  appendLog(env, { kind: "ask", model: "m1", prompt: "hello", content: "world" });
  const json = makeIo();
  const code = await cmdLogs({ flags: { json: true }, env, io: json.io });
  assert.equal(code, 0);
  const parsed = JSON.parse(json.lines.join("\n"));
  assert.equal(parsed[0].prompt, "hello");
  const cleared = makeIo();
  await cmdLogs({ flags: { clear: true }, env, io: cleared.io });
  assert.equal(readLogs(env, 10).length, 0);
});

test("roles: add → list → ask --role gửi system prompt", async (t) => {
  const fixture = await startRecordingFixture();
  t.after(() => fixture.server.close());
  const env = tempEnv();
  const add = makeIo();
  const code = await cmdRoles({ flags: { _: ["add", "gia-su", "Bạn là giáo sư AI"] }, env, io: add.io });
  assert.equal(code, 0);
  assert.ok(add.lines.join("\n").includes("gia-su"));
  assert.equal(loadRoles(env)["gia-su"], "Bạn là giáo sư AI");
  assert.ok(rolesFile(env).endsWith("roles.json"));
  saveRoles(env, { ...loadRoles(env), "trợ-giúp": "Trả lời ngắn gọn" });
  assert.deepEqual(Object.keys(loadRoles(env)).sort(), ["gia-su", "trợ-giúp"]);

  const ask = makeIo();
  const askCode = await cmdAsk({
    flags: { key: "testkey", "base-url": fixture.baseUrl, role: "gia-su", _: ["Giải thích thuật toán"] },
    env,
    io: ask.io,
  });
  assert.equal(askCode, 0);
  assert.equal(fixture.state.lastBody.messages[0].role, "system");
  assert.equal(fixture.state.lastBody.messages[0].content, "Bạn là giáo sư AI");

  const missing = makeIo();
  const missCode = await cmdAsk({ flags: { key: "testkey", "base-url": fixture.baseUrl, role: "không-có" }, env, io: missing.io });
  assert.equal(missCode, 2);
});

test("wizard: chọn ngôn ngữ/key/mode → ghi config, validate key qua gateway", async (t) => {
  const fixture = await startRecordingFixture();
  t.after(() => fixture.server.close());
  const env = tempEnv({ CRIZON_BASE_URL: fixture.baseUrl });
  const { io, lines } = makeIo();
  let selectCalls = 0;
  const uiFns = {
    select: async () => {
      selectCalls += 1;
      return selectCalls === 1 ? { index: 1, item: LANGS[1] } : { index: 0, item: { code: "chat" } };
    },
    inputHidden: async () => "testkey",
    confirm: async () => true,
  };
  const result = await runWizard({ env, io, uiFns });
  assert.equal(result.harness, "chat");
  assert.equal(result.apiKey, "testkey");
  const saved = JSON.parse(readFileSync(env.CRIZON_CONFIG_PATH, "utf8"));
  assert.equal(saved.lang, "en");
  assert.equal(saved.apiKey, "testkey");
  assert.equal(saved.harness, "chat");
  assert.ok(lines.join("\n").includes("2 model"));
  setLang("vi");
});

test("wizard: key sai → hỏi thử lại, chọn không thì huỷ", async (t) => {
  const fixture = await startRecordingFixture();
  t.after(() => fixture.server.close());
  const env = tempEnv({ CRIZON_BASE_URL: fixture.baseUrl });
  const { io } = makeIo();
  const uiFns = {
    select: async () => ({ index: 0, item: LANGS[0] }),
    inputHidden: async () => "sai-key",
    confirm: async () => false,
  };
  const result = await runWizard({ env, io, uiFns });
  assert.equal(result, null);
  setLang("vi");
});

test("doctor: gateway OK + model trong catalog → exit 0; key sai → exit 1", async (t) => {
  const fixture = await startRecordingFixture();
  t.after(() => fixture.server.close());
  const env = tempEnv({ CRIZON_BASE_URL: fixture.baseUrl, CRIZON_API_KEY: "testkey" });
  const ok = makeIo();
  const code = await runDoctor({ env, flags: { json: true }, io: ok.io, version: "1.0.0" });
  assert.equal(code, 0);
  const parsed = JSON.parse(ok.lines.join("\n"));
  assert.ok(parsed.rows.some((r) => r.label.includes("Gateway") && r.level === "ok"));
  assert.ok(parsed.rows.some((r) => r.label.includes("API key") && r.level === "ok"));

  const badEnv = tempEnv({ CRIZON_BASE_URL: fixture.baseUrl, CRIZON_API_KEY: "sai-key" });
  const bad = makeIo();
  const badCode = await runDoctor({ env: badEnv, flags: {}, io: bad.io, version: "1.0.0" });
  assert.equal(badCode, 1);
  assert.ok(bad.lines.join("\n").includes("✗"));
});

test("settingsMenu: đổi ngôn ngữ ghi vào config", async () => {
  const env = tempEnv();
  const { io } = makeIo();
  let selectCalls = 0;
  const ui = {
    select: async () => {
      selectCalls += 1;
      if (selectCalls === 1) return { item: { code: "lang" } };
      if (selectCalls === 2) return { index: 1, item: LANGS[1] };
      return { item: { code: "exit" } };
    },
  };
  const code = await settingsMenu({ env, io, ui });
  assert.equal(code, 0);
  const saved = JSON.parse(readFileSync(env.CRIZON_CONFIG_PATH, "utf8"));
  assert.equal(saved.lang, "en");
  assert.equal(getLang(), "en");
  setLang("vi");
});

test("cmdLanguage: đổi + lưu config, mã sai bị chặn", async () => {
  const env = tempEnv();
  const ok = makeIo();
  const code = await cmdLanguage({ flags: { _: ["en"] }, env, io: ok.io });
  assert.equal(code, 0);
  assert.match(ok.lines.join("\n"), /English|language/i);
  const saved = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  assert.equal(saved.lang, "en");

  const bad = makeIo();
  assert.equal(await cmdLanguage({ flags: { _: ["xx"] }, env, io: bad.io }), 2);

  const json = makeIo();
  await cmdLanguage({ flags: { _: [], json: true }, env, io: json.io });
  const parsed = JSON.parse(json.lines.join("\n"));
  assert.equal(parsed.lang, "en");
  assert.deepEqual(parsed.available, ["vi", "en"]);
  setLang("vi");
});

test("i18n: chuỗi lỗi/usage/maskKey theo ngôn ngữ (en)", async () => {
  setLang("en");
  const env = tempEnv();
  const { io, lines } = makeIo();
  const code = await cmdLogin({ flags: {}, env, io });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /Create an API key at/);
  assert.equal(maskKey(""), "(not set)");
  setLang("vi");
  assert.equal(maskKey(""), "(chưa có)");
});

test("resolveConfig: ưu tiên flag > env > file", () => {
  const env = tempEnv({ CRIZON_API_KEY: "env-key", CRIZON_MODEL: "env-model" });
  assert.equal(resolveConfig({ env }).apiKey, "env-key");
  assert.equal(resolveConfig({ flags: { key: "flag-key" }, env }).apiKey, "flag-key");
  assert.equal(resolveConfig({ env }).source, "env");
  assert.equal(resolveConfig({ flags: { lang: "en" }, env }).lang, "en");
});
