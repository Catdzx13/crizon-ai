import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { cmdChat } from "../src/commands.mjs";
import { CrizonClient } from "../src/client.mjs";
import { createComposer } from "../src/composer.mjs";
import { saveSession } from "../src/sessions.mjs";
import { colorizeLogo, printWelcome } from "../src/welcome.mjs";
import { setLang } from "../src/i18n.mjs";

function fakeTty(columns = 84) {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = columns;
  const chunks = [];
  output.on("data", (c) => chunks.push(String(c)));
  const io = { out: (line = "") => chunks.push(`${line}\n`), write() {}, err() {}, stdin: input, stdout: output };
  return { input, io, chunks, text: () => chunks.join("") };
}

function makeIo() {
  const lines = [];
  return { io: { out: (line = "") => lines.push(String(line)), write() {}, err() {} }, lines };
}

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, timeout = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return true;
    await tick(20);
  }
  return false;
}

function startChatFixture() {
  const state = { lastBody: null };
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    if (req.url !== "/v1/chat/completions" || auth !== "Bearer testkey") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "invalid_api_key", retryable: false } }));
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      state.lastBody = body;
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Xin chào từ model Crizon!" } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const piece of ["Xin ", "chào ", "từ model Crizon!"]) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 5 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no address");
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1`, state });
    });
  });
}

function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-tui-"));
  const env = { ...process.env, CRIZON_CONFIG_PATH: join(dir, "config.json"), CRIZON_HOME: join(dir, "home") };
  delete env.CRIZON_API_KEY;
  delete env.CRIZON_BASE_URL;
  delete env.CRIZON_MODEL;
  delete env.CRIZON_LANG;
  return env;
}

test("composer: khung nhập, submit, busy spinner, lịch sử ↑", async () => {
  const screen = fakeTty();
  const composer = createComposer(screen.io, { footer: "model · phiên default" });
  assert.ok(composer);

  const first = composer.read();
  await tick();
  screen.input.write("xin chào\r");
  assert.equal(await first, "xin chào");
  let drawn = screen.text();
  assert.match(drawn, /┃/);
  assert.match(drawn, /╹/);
  assert.match(drawn, /❯/);
  assert.match(drawn, /phiên default/);
  assert.ok(drawn.includes("xin chào"));

  composer.setBusy(true, "Đang kết nối model…");
  assert.ok(screen.text().includes("Đang kết nối model…"), "busy phải hiện trạng thái");
  composer.setBusy(false);

  const second = composer.read();
  await tick();
  screen.input.write("dòng hai\r");
  assert.equal(await second, "dòng hai");

  const third = composer.read();
  await tick();
  screen.input.write("\u001b[A"); // ↑ nhớ lại "dòng hai"
  assert.ok(screen.text().includes("dòng hai"));
  screen.input.write("\r");
  assert.equal(await third, "dòng hai");

  const fourth = composer.read();
  await tick();
  screen.input.write("\u0003");
  await tick(10);
  assert.ok(screen.text().includes("Ctrl+C"), "lần Ctrl+C đầu hiện gợi ý");
  screen.input.write("\u0003");
  assert.equal(await fourth, null);

  composer.destroy();
  composer.print("dòng trên khung");
  await tick(110);
  assert.ok(screen.text().includes("dòng trên khung"));
});

test("printWelcome: non-TTY in plain logo + tips + info phiên", () => {
  const { io, lines } = makeIo();
  printWelcome(io, { version: "1.0.0", model: "crizon/gpt-standard", session: "default", sessionCount: 3 });
  const text = lines.join("\n");
  assert.ok(text.includes("Crizon AI 1.0.0"));
  assert.ok(text.includes("/ ___|"), "mặc định = wordmark line-art (big)");
  assert.ok(text.includes("Tips for getting started:"));
  assert.ok(text.includes("crizon/gpt-standard"));
  assert.ok(text.includes("3 tin nhắn"));
});

test("colorizeLogo: gradient theo cột + shimmer quét sáng", () => {
  const line = "█▀▀▀ █▀▀▀";
  assert.deepEqual(colorizeLogo([line], null, false), [line], "tắt màu thì giữ nguyên ký tự");
  const gradient = colorizeLogo([line], null, true)[0];
  assert.match(gradient, /\u001b\[38;5;51m█/, "cột đầu = đầu ramp cyan");
  assert.match(gradient, /\u001b\[38;5;99m▀/, "cột cuối = cuối ramp tím");
  const shimmer = colorizeLogo([line], 0, true)[0];
  assert.ok(shimmer.startsWith("\u001b[38;5;231m█"), "cột đang quét sáng trắng");
  const far = colorizeLogo([line], 30, true)[0];
  assert.ok(!far.includes("231m"), "ngoài vùng quét không sáng");
});

test("cmdChat (TTY): welcome + composer + stream + /exit", async (t) => {
  const fixture = await startChatFixture();
  t.after(() => fixture.server.close());
  const screen = fakeTty(90);
  const chat = cmdChat({
    flags: { key: "testkey", "base-url": fixture.baseUrl, model: "crizon/gpt-standard", logo: "oc" },
    env: tempEnv(),
    io: screen.io,
  });

  const welcome = await waitFor(() => screen.text().includes("Tips for getting started:"));
  assert.ok(welcome, "phải hiện màn chào");
  const plain = () => screen.text().replace(/\u001b\[[0-9;]*m/g, "");
  assert.ok(plain().includes("█▀▀▀"), "phải có wordmark (style oc)");

  await tick(30);
  screen.input.write("Xin chào\r");
  const replied = await waitFor(() => screen.text().includes("từ model Crizon!"));
  assert.ok(replied, "phải nhận stream trả lời");
  const drawn = screen.text().replace(/\u001b\[[0-9;]*m/g, "");
  assert.ok(drawn.includes("❯ Xin chào"), "phải echo câu hỏi của user");
  assert.ok(drawn.includes("crizon/gpt-standard"), "footer có model");
  const frame = drawn.split(/\u001b\[\d+A\u001b\[J/).pop() ?? "";
  assert.ok(frame.includes("╹"), "khung nhập phải còn sau khi trả lời");
  assert.ok(!frame.includes("Đang kết nối model…"), "busy phải tắt sau khi xong");

  screen.input.write("/exit\r");
  const code = await Promise.race([chat, tick(4000).then(() => "timeout")]);
  assert.equal(code, 0);
  assert.ok(screen.text().includes("Tạm biệt!"));
});

test("cmdChat (TTY): Ctrl+C hai lần để thoát", async (t) => {
  const fixture = await startChatFixture();
  t.after(() => fixture.server.close());
  const screen = fakeTty(90);
  const chat = cmdChat({
    flags: { key: "testkey", "base-url": fixture.baseUrl, model: "crizon/gpt-standard" },
    env: tempEnv(),
    io: screen.io,
  });
  await waitFor(() => screen.text().includes("Tips for getting started:"));
  await tick(30);
  screen.input.write("\u0003");
  await tick(10);
  screen.input.write("\u0003");
  const code = await Promise.race([chat, tick(4000).then(() => "timeout")]);
  assert.equal(code, 0);
});

const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
const lastFrame = (text) => strip(text).split(/\u001b\[\d+A\u001b\[J/).pop() ?? "";

test("composer: autocomplete lệnh khi gõ '/' (↑↓ · Tab · Enter)", async () => {
  const screen = fakeTty(96);
  const composer = createComposer(screen.io, { footer: "f" });
  composer.setCommands([
    { name: "/help", description: "trợ giúp" },
    { name: "/model", description: "đổi model" },
    { name: "/settings", description: "panel" },
  ]);

  const pending = composer.read();
  await tick();
  screen.input.write("/");
  const drawn = strip(screen.text());
  assert.ok(drawn.includes("/model"), "popup phải liệt kê lệnh");
  assert.ok(drawn.includes("đổi model"), "popup phải có mô tả");

  screen.input.write("\u001b[B"); // ↓ chọn /model
  screen.input.write("\t"); // Tab điền vào ô nhập
  assert.ok(lastFrame(screen.text()).includes("/model"), "Tab phải điền lệnh vào buffer");

  screen.input.write("hay lắm");
  screen.input.write("\r");
  assert.equal(await pending, "/model hay lắm");

  // Enter khi đang mở popup và chưa gõ đủ lệnh → chọn lệnh, không submit
  const second = composer.read();
  await tick();
  screen.input.write("/set");
  screen.input.write("\r");
  assert.ok(lastFrame(screen.text()).includes("/settings"));
  screen.input.write("abc");
  screen.input.write("\r");
  assert.equal(await second, "/settings abc");
  composer.destroy();
});

test("cmdChat (TTY): /sessions đổi phiên + cập nhật footer", async (t) => {
  const fixture = await startChatFixture();
  t.after(() => fixture.server.close());
  const env = tempEnv();
  saveSession(env, {
    name: "work",
    model: "",
    messages: [{ role: "user", content: "cũ" }, { role: "assistant", content: "ok" }],
  });
  const screen = fakeTty(96);
  const chat = cmdChat({
    flags: { key: "testkey", "base-url": fixture.baseUrl, model: "crizon/gpt-standard", logo: "oc" },
    env,
    io: screen.io,
    ui: { select: async () => ({ index: 0, item: { id: "work" } }) },
  });
  await waitFor(() => screen.text().includes("Tips for getting started:"));
  await tick(30);
  screen.input.write("/sessions\r");
  const switched = await waitFor(() => screen.text().includes("đã chuyển sang phiên 'work'"));
  assert.ok(switched, "phải báo chuyển phiên");
  screen.input.write("/exit\r");
  const code = await Promise.race([chat, tick(4000).then(() => "timeout")]);
  assert.equal(code, 0);
});

test("cmdChat (TTY): Esc dừng giữa stream", async (t) => {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "bắt đầu\n" } }] })}\n\n`);
      // cố tình không kết thúc → chờ Esc
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const screen = fakeTty(96);
  const chat = cmdChat({
    flags: { key: "testkey", "base-url": `http://127.0.0.1:${address.port}/v1`, model: "crizon/gpt-standard", logo: "oc" },
    env: tempEnv(),
    io: screen.io,
  });
  await waitFor(() => screen.text().includes("Tips for getting started:"));
  await tick(30);
  screen.input.write("hỏi gì đó\r");
  const streamed = await waitFor(() => screen.text().includes("bắt đầu"));
  assert.ok(streamed, "phải thấy chunk đầu");
  screen.input.write("\u001b");
  const stopped = await waitFor(() => screen.text().includes("đã dừng theo yêu cầu"));
  assert.ok(stopped, "Esc phải dừng stream");
  screen.input.write("/exit\r");
  const code = await Promise.race([chat, tick(4000).then(() => "timeout")]);
  assert.equal(code, 0);
});

test("composer: popup '/' cuộn theo con trỏ khi nhiều lệnh (12 mục)", async () => {
  const screen = fakeTty(96);
  const composer = createComposer(screen.io, { footer: "f" });
  composer.setCommands(Array.from({ length: 12 }, (_, index) => ({ name: `/cmd${index + 1}`, description: `desc ${index + 1}` })));
  const pending = composer.read();
  await tick();
  screen.input.write("/");
  for (let step = 0; step < 8; step += 1) screen.input.write("\u001b[B");
  await tick(40);
  const frame = screen.text().replace(/\u001b\[[0-9;]*m/g, "").split(/\u001b\[\d+A\u001b\[J/).pop();
  assert.ok(frame.includes("/cmd9"), `phải thấy /cmd9 sau khi cuộn: ${frame}`);
  assert.ok(frame.includes("…"), "phải có chỉ báo còn mục khác");
  screen.input.write("\r"); // điền lệnh đang chọn
  screen.input.write("\r"); // gửi
  assert.equal(await pending, "/cmd9");
  composer.destroy();
});

test("composer: phụ đề (vietsub) hiện dưới lệnh đang chọn", async () => {
  const screen = fakeTty(96);
  const composer = createComposer(screen.io, { footer: "f" });
  composer.setCommands([
    { name: "/clear", description: "clear the current conversation", subtitle: "xoá hội thoại hiện tại" },
    { name: "/exit", description: "quit" },
  ]);
  const pending = composer.read();
  await tick();
  screen.input.write("/");
  await tick(30);
  const frame = screen.text().replace(/\u001b\[[0-9;]*m/g, "").split(/\u001b\[\d+A\u001b\[J/).pop();
  assert.ok(frame.includes("xoá hội thoại hiện tại"), "phải thấy phụ đề vietsub dưới lệnh đang chọn");
  screen.input.write("\r"); // điền lệnh đang chọn
  screen.input.write("\r"); // gửi
  assert.equal(await pending, "/clear");
  composer.destroy();
});

test("cmdChat (TTY): custom command .md ($ARGUMENTS · $1 · !shell) + /status + /undo", async (t) => {
  const fixture = await startChatFixture();
  t.after(() => fixture.server.close());
  const dir = mkdtempSync(join(tmpdir(), "crizon-cmd-chat-"));
  mkdirSync(join(dir, ".opencode", "commands"), { recursive: true });
  writeFileSync(
    join(dir, ".opencode", "commands", "greet.md"),
    "---\ndescription: Chào hỏi\n---\nXin chào $1, tổng: $ARGUMENTS\n!`echo SHELL_OK`",
  );
  const screen = fakeTty(96);
  const chat = cmdChat({
    flags: { key: "testkey", "base-url": fixture.baseUrl, model: "crizon/gpt-standard", logo: "oc" },
    env: tempEnv(),
    io: screen.io,
    cwd: dir,
  });
  await waitFor(() => screen.text().includes("Tips for getting started:"));
  await tick(30);

  screen.input.write("/greet An\r");
  const sent = await waitFor(() =>
    fixture.state.lastBody?.messages?.some((message) => typeof message.content === "string" && message.content.includes("Xin chào An")));
  assert.ok(sent, "prompt mở rộng phải được gửi tới model");
  const content = fixture.state.lastBody.messages.at(-1).content;
  assert.ok(content.includes("tổng: An"), content);
  assert.ok(content.includes("SHELL_OK"), content);

  screen.input.write("/status\r");
  assert.ok(await waitFor(() => screen.text().includes("gateway")));

  screen.input.write("/undo\r");
  assert.ok(await waitFor(() => screen.text().includes("đã bỏ lượt cuối")));

  screen.input.write("/exit\r");
  const code = await Promise.race([chat, tick(4000).then(() => "timeout")]);
  assert.equal(code, 0);
});

test("cmdChat (TTY): /language đổi ngay + lưu config (i18n vi/en)", async (t) => {
  const fixture = await startChatFixture();
  t.after(() => fixture.server.close());
  t.after(() => setLang("vi"));
  const env = tempEnv();
  const screen = fakeTty(96);
  const chat = cmdChat({
    flags: { key: "testkey", "base-url": fixture.baseUrl, model: "crizon/gpt-standard", logo: "oc" },
    env,
    io: screen.io,
  });
  await waitFor(() => screen.text().includes("Tips for getting started:"));
  await tick(30);

  screen.input.write("/language en\r");
  assert.ok(await waitFor(() => screen.text().includes("English")), "phải báo đổi ngôn ngữ");
  const saved = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  assert.equal(saved.lang, "en");

  // UI đổi ngay: /help sau đó phải là tiếng Anh
  screen.input.write("/help\r");
  assert.ok(await waitFor(() => screen.text().includes("switch model")), "help phải hiện tiếng Anh ngay");

  screen.input.write("/language vi\r");
  assert.ok(await waitFor(() => screen.text().includes("Tiếng Việt")));

  screen.input.write("/exit\r");
  const code = await Promise.race([chat, tick(4000).then(() => "timeout")]);
  assert.equal(code, 0);
});

test("client.chatStream: abort qua signal", async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "a" } }] })}\n\n`);
    // treo
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new CrizonClient({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "testkey" });
  const controller = new AbortController();
  await assert.rejects(
    () => client.chatStream({ model: "m", messages: [], signal: controller.signal }, () => controller.abort()),
    (error) => error?.name === "AbortError",
  );
});
