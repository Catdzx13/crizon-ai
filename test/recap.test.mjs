import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cmdRecap } from "../src/commands.mjs";
import { buildRecapPrompt, parseRecap, RECAP_HISTORY_MAX_BYTES } from "../src/recap.mjs";
import { saveSession, sessionFile } from "../src/sessions.mjs";
import { startMockGateway } from "../tools/mock-gateway.mjs";

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
  const dir = mkdtempSync(join(tmpdir(), "crizon-recap-"));
  return { dir, env: { CRIZON_CONFIG_PATH: join(dir, "config.json"), CRIZON_HOME: join(dir, "home") } };
}

test("recap: parseRecap đọc JSON (kể cả bọc ```json), next_action null, text thô", () => {
  assert.deepEqual(parseRecap('{"summary":"Đã xong A.","next_action":"Chạy test."}'), { summary: "Đã xong A.", nextAction: "Chạy test." });
  assert.deepEqual(parseRecap('```json\n{"summary":"Đã xong B.","next_action":null}\n```'), { summary: "Đã xong B.", nextAction: "" });
  assert.deepEqual(parseRecap("Chỉ là text thường"), { summary: "Chỉ là text thường", nextAction: "" });
  assert.deepEqual(parseRecap(""), { summary: "", nextAction: "" });
});

test("recap: prompt chỉ gồm user/assistant + cắt theo trần bytes", () => {
  const huge = "x".repeat(RECAP_HISTORY_MAX_BYTES);
  const { prompt, included } = buildRecapPrompt([
    { role: "system", content: "BÍ MẬT HỆ THỐNG" },
    { role: "user", content: "câu 1" },
    { role: "assistant", content: "trả lời 1" },
    { role: "tool", content: "TOOL OUTPUT" },
    { role: "user", content: huge },
  ]);
  assert.ok(!prompt.includes("BÍ MẬT HỆ THỐNG"), "không đưa system vào recap");
  assert.ok(!prompt.includes("TOOL OUTPUT"), "không đưa tool output vào recap");
  assert.ok(prompt.includes("User: câu 1") && prompt.includes("Assistant: trả lời 1"));
  assert.equal(included, 2, "message vượt trần bytes bị bỏ");
  assert.ok(Buffer.byteLength(prompt, "utf8") <= RECAP_HISTORY_MAX_BYTES + 2048, "prompt nằm trong trần cho phép");
});

test("cmdRecap: tóm tắt phiên qua model, KHÔNG ghi vào phiên", async (t) => {
  const mock = await startMockGateway({ port: 0, quiet: true });
  t.after(() => mock.close());
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  saveSession(env, {
    name: "default",
    model: "crizon/gpt-standard",
    messages: [
      { role: "user", content: "Làm CLI Crizon" },
      { role: "assistant", content: "Đã xong phần auth" },
    ],
  });
  const before = readFileSync(sessionFile(env, "default"), "utf8");

  const { io, lines } = makeIo();
  const code = await cmdRecap({ env: { ...env, CRIZON_BASE_URL: mock.baseUrl, CRIZON_API_KEY: "czn_recap_test" }, io });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /Chào từ mock gateway/);
  assert.equal(readFileSync(sessionFile(env, "default"), "utf8"), before, "recap không được ghi vào phiên");
});

test("cmdRecap: phiên rỗng → nhắc chưa có nội dung (exit 0)", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { io, lines } = makeIo();
  const code = await cmdRecap({ env: { ...env, CRIZON_API_KEY: "czn_recap_test" }, io });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /chưa có nội dung|nothing to recap/);
});

test("cmdRecap: thiếu API key → exit 2", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { io } = makeIo();
  const code = await cmdRecap({ env, io });
  assert.equal(code, 2);
});
