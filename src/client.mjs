import { t } from "./i18n.mjs";

/**
 * Client tối giản cho AI Gateway (OpenAI-compatible).
 * - GET  {base}/models
 * - POST {base}/chat/completions  (JSON hoặc SSE khi stream: true)
 * Lỗi theo envelope chuẩn của Gateway: { error: { code, legacy_code?, message?, request_id?, retryable } }
 */
export class ApiError extends Error {
  constructor(status, code, message, retryable = false, requestId = null, legacyCode = null) {
    super(message || code || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = Boolean(retryable);
    this.requestId = requestId;
    this.legacyCode = legacyCode;
  }
}

export class CrizonClient {
  constructor({ baseUrl, apiKey, fetchImpl } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.apiKey = apiKey || "";
    this.fetchImpl = fetchImpl || fetch;
  }

  async #fetchJson(path, { method = "GET", body, headers, signal } = {}) {
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      throw new ApiError(0, "network_error", t("err.network", { base: this.baseUrl, detail: err?.message || String(err) }), true);
    }
    if (!res.ok) {
      let envelope = null;
      try {
        envelope = await res.json();
      } catch {
        /* body không phải JSON */
      }
      const e = envelope?.error || {};
      throw new ApiError(res.status, e.code || `http_${res.status}`, e.message || res.statusText, e.retryable === true, e.request_id, e.legacy_code);
    }
    return res;
  }

  async models() {
    const res = await this.#fetchJson("/models");
    return res.json();
  }

  async chat({ model, messages, temperature, maxTokens, signal }) {
    const body = { model, messages, stream: false };
    if (temperature !== undefined && !Number.isNaN(temperature)) body.temperature = temperature;
    if (maxTokens !== undefined && !Number.isNaN(maxTokens)) body.max_tokens = maxTokens;
    const res = await this.#fetchJson("/chat/completions", { method: "POST", body, signal });
    return res.json();
  }

  /** Stream SSE: gọi onDelta(text) cho từng mảnh; trả { content, usage }. Huỷ qua signal. */
  async chatStream({ model, messages, temperature, maxTokens, signal }, onDelta = () => {}) {
    const body = { model, messages, stream: true };
    if (temperature !== undefined && !Number.isNaN(temperature)) body.temperature = temperature;
    if (maxTokens !== undefined && !Number.isNaN(maxTokens)) body.max_tokens = maxTokens;
    const res = await this.#fetchJson("/chat/completions", { method: "POST", body, signal });
    if (!res.body) throw new ApiError(res.status, "empty_stream", t("err.emptyStream"), false);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = null;
    let done = false;
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (readerDone) done = true;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          done = true;
          break;
        }
        let json = null;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const choice = json?.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.message?.content ?? "";
        if (delta) {
          content += delta;
          onDelta(delta);
        }
        if (json?.usage) usage = json.usage;
      }
    }
    return { content, usage };
  }
}
