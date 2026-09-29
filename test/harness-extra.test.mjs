import assert from "node:assert/strict";
import test from "node:test";

import { compatProbeUrl, HARNESSES } from "../src/harness.mjs";

test("harness: aider là OpenAI-compatible (OPENAI_API_BASE + AIDER_MODEL)", () => {
  const env = Object.fromEntries(
    HARNESSES.aider.env({ baseUrl: "https://gw.test/v1", apiKey: "czn_x", model: "deepseek-chat" }),
  );
  assert.equal(env.OPENAI_API_BASE, "https://gw.test/v1");
  assert.equal(env.OPENAI_API_KEY, "czn_x");
  assert.equal(env.AIDER_MODEL, "openai/deepseek-chat");
  assert.equal(compatProbeUrl("aider", "https://gw.test/v1"), "https://gw.test/v1/models");
});

test("harness: qwen là OpenAI-compatible (OPENAI_BASE_URL + OPENAI_MODEL)", () => {
  const env = Object.fromEntries(
    HARNESSES.qwen.env({ baseUrl: "https://gw.test/v1/", apiKey: "czn_y", model: "" }),
  );
  assert.equal(env.OPENAI_BASE_URL, "https://gw.test/v1");
  assert.equal(env.OPENAI_API_KEY, "czn_y");
  assert.equal(env.OPENAI_MODEL, undefined);
  assert.equal(compatProbeUrl("qwen", "https://gw.test/v1"), "https://gw.test/v1/models");
});

test("harness: probe URL theo từng loại (codex/claude không đổi)", () => {
  assert.equal(compatProbeUrl("codex", "https://gw.test/v1"), "https://gw.test/v1/responses");
  assert.equal(compatProbeUrl("claude", "https://gw.test/v1"), "https://gw.test/v1/messages");
  assert.equal(compatProbeUrl("opencode", "https://gw.test/v1"), "https://gw.test/v1/messages");
});
