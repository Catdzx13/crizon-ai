#!/usr/bin/env node
/**
 * Mock AI Gateway cục bộ để test `crizon-ai` mà không cần gateway thật.
 *
 * Chạy trực tiếp:  node apps/ai-cli/tools/mock-gateway.mjs [--port 18787]
 * Hoặc import:     const mock = await startMockGateway({ port: 0, quiet: true })
 *
 * Giả lập đủ 3 giao thức:
 *   GET  /v1/models              (OpenAI)
 *   POST /v1/chat/completions    (JSON + SSE, có usage)
 *   POST /v1/messages            (Anthropic: JSON + SSE, count_tokens)
 *   POST /v1/responses           (OpenAI Responses: JSON + SSE)
 *   HEAD /v1/messages|responses  → 204 (preflight của crizon-ai setup/doctor)
 *
 * Chấp nhận mọi key không rỗng (test cục bộ). Không gọi model thật.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const MODELS = ["crizon/gpt-standard", "crizon/deepseek-pro", "crizon/claude-brain"];

let logEnabled = true;
const banner = (line) => {
  if (logEnabled) process.stdout.write(`${line}\n`);
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve(null);
      }
    });
  });
}

function lastUserText(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (typeof content === "string") return content.slice(0, 120);
    if (Array.isArray(content)) {
      const text = content.find((part) => part && typeof part.text === "string");
      if (text) return String(text.text).slice(0, 120);
    }
  }
  if (typeof payload?.input === "string") return payload.input.slice(0, 120);
  return "(trống)";
}

function demoAnswer(question) {
  return `# Chào từ mock gateway\n\nBạn vừa gửi: **${question}**\n\n- Đây là phản hồi giả lập, không gọi model thật\n- Stream SSE + usage hoạt động như gateway thật\n- Thử \`crizon-ai setup claude\` và \`crizon-ai doctor\` với mock này\n`;
}

function chunks(text, size = 24) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function authFrom(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  const apiKey = req.headers["x-api-key"];
  return (Array.isArray(apiKey) ? apiKey[0] : apiKey)?.trim() || "";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function anthropicError(res, status, message) {
  sendJson(res, status, { type: "error", error: { type: "api_error", message } });
}

async function handler(req, res) {
  const url = (req.url || "/").split("?")[0];
  banner(`→ ${req.method} ${url}`);

  if (req.method === "GET" && (url === "/healthz" || url === "/v1/health")) {
    return sendJson(res, 200, { ok: true, mock: true });
  }
  if (req.method === "HEAD" && (url === "/v1/messages" || url === "/v1/responses")) {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, { allow: "GET, POST, HEAD, OPTIONS" });
    return res.end();
  }

  const key = authFrom(req);
  if (!key) {
    if (url.startsWith("/v1/messages")) return anthropicError(res, 401, "missing api key");
    return sendJson(res, 401, { error: { code: "unauthorized", message: "missing api key", retryable: false } });
  }

  if (req.method === "GET" && url === "/v1/models") {
    return sendJson(res, 200, { object: "list", data: MODELS.map((id) => ({ id, object: "model", owned_by: "crizon-mock" })) });
  }

  if (req.method === "POST" && url === "/v1/chat/completions") {
    const body = (await readBody(req)) || {};
    const model = typeof body.model === "string" && body.model ? body.model : MODELS[0];
    const answer = demoAnswer(lastUserText(body));
    if (body.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant" } }] })}\n\n`);
      for (const piece of chunks(answer)) {
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 40 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    return sendJson(res, 200, {
      id: "chatcmpl-mock",
      object: "chat.completion",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 40 },
    });
  }

  if (req.method === "POST" && url === "/v1/messages/count_tokens") {
    const body = (await readBody(req)) || {};
    const bytes = Buffer.byteLength(JSON.stringify(body.messages ?? body.input ?? {}), "utf8");
    return sendJson(res, 200, { input_tokens: Math.max(1, Math.ceil(bytes / 4)) });
  }

  if (req.method === "POST" && url === "/v1/messages") {
    const body = (await readBody(req)) || {};
    const model = typeof body.model === "string" ? body.model : "claude-mock";
    const answer = demoAnswer(lastUserText(body));
    const pieces = chunks(answer);
    if (body.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      const send = (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      send("message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 0 } } });
      send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      for (const piece of pieces) send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } });
      send("content_block_stop", { type: "content_block_stop", index: 0 });
      send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } });
      send("message_stop", { type: "message_stop" });
      return res.end();
    }
    return sendJson(res, 200, {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: answer }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 9, output_tokens: 40 },
    });
  }

  if (req.method === "POST" && url === "/v1/responses") {
    const body = (await readBody(req)) || {};
    const model = typeof body.model === "string" ? body.model : "gpt-mock";
    const answer = demoAnswer(lastUserText(body));
    const base = (status, output, usage) => ({
      id: "resp_mock",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status,
      model,
      output,
      usage: usage ? { input_tokens: 9, output_tokens: 40, total_tokens: 49 } : undefined,
    });
    if (body.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      let seq = 0;
      const send = (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: seq++, ...payload })}\n\n`);
      send("response.created", { response: base("in_progress", []) });
      send("response.output_item.added", { output_index: 0, item: { type: "message", id: "msg_mock", status: "in_progress", role: "assistant", content: [] } });
      send("response.content_part.added", { item_id: "msg_mock", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      for (const piece of chunks(answer)) send("response.output_text.delta", { item_id: "msg_mock", output_index: 0, content_index: 0, delta: piece });
      send("response.output_text.done", { item_id: "msg_mock", output_index: 0, content_index: 0, text: answer });
      send("response.content_part.done", { item_id: "msg_mock", output_index: 0, content_index: 0, part: { type: "output_text", text: answer, annotations: [] } });
      const item = { type: "message", id: "msg_mock", status: "completed", role: "assistant", content: [{ type: "output_text", text: answer, annotations: [] }] };
      send("response.output_item.done", { output_index: 0, item });
      send("response.completed", { response: base("completed", [item], { input_tokens: 9, output_tokens: 40 }) });
      return res.end();
    }
    const item = { type: "message", id: "msg_mock", status: "completed", role: "assistant", content: [{ type: "output_text", text: answer, annotations: [] }] };
    return sendJson(res, 200, base("completed", [item], { input_tokens: 9, output_tokens: 40 }));
  }

  sendJson(res, 404, { error: { code: "not_found", message: `${req.method} ${url}`, retryable: false } });
}

/** Khởi động mock; trả { port, baseUrl, close }. */
export async function startMockGateway({ port = 18787, quiet = false } = {}) {
  logEnabled = !quiet;
  const server = createServer(handler);
  server.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    port: actualPort,
    baseUrl: `http://127.0.0.1:${actualPort}/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    server,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const portArg = args.indexOf("--port");
  const port = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT || 18787);
  const mock = await startMockGateway({ port });
  banner("");
  banner("  ╭──────────────────────────────────────────────────────────╮");
  banner("  │  crizon-ai MOCK GATEWAY (không gọi model thật)           │");
  banner("  ╰──────────────────────────────────────────────────────────╯");
  banner(`  Base URL: ${mock.baseUrl}`);
  banner(`  Model   : ${MODELS.join(" · ")}`);
  banner("  Key     : bất kỳ chuỗi không rỗng (vd: czn_local_test)");
  banner("");
  banner("  Nhanh nhất — dùng demo 1 lệnh (mock + chat tự động):");
  banner("    node apps/ai-cli/tools/demo.mjs");
  banner("");
  banner("  Ctrl+C để dừng.");
  banner("");
}
